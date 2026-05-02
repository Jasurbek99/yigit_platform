"""Admin viewset for SheetRowSetting — Sheet Control v2.

Endpoints (ADR-0007, ADR-0008, ADR-0009, ADR-0010):
  GET    /api/v1/export/admin/sheet-rows/              — list active rows
  GET    /api/v1/export/admin/sheet-rows/?include_deleted=1 — include soft-deleted
  GET    /api/v1/export/admin/sheet-rows/{id}/         — single row
  PATCH  /api/v1/export/admin/sheet-rows/{id}/         — update with optimistic lock
  DELETE /api/v1/export/admin/sheet-rows/{id}/         — soft-delete (pre-condition: hidden ≥30d)
  POST   /api/v1/export/admin/sheet-rows/{id}/restore/ — restore soft-deleted row
  POST   /api/v1/export/admin/sheet-rows/reorder/      — sparse display_order update
  POST   /api/v1/export/admin/sheet-rows/permissions/bulk/ — grant/revoke user exceptions

Security note: export_manager currently has shipment.edit permission (D5 parity) and
can therefore access PATCH. A future ticket should tighten writes to director-only.
For Phase 1 this matches the existing admin-tab permission model.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models.user import ROLE_CHOICES
from apps.core.permissions import DynamicResourcePermission
from apps.export.models import AuditLog, SheetRowSetting, SheetRowRoleTrigger, SheetRowUserPermission
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

logger = logging.getLogger(__name__)

_ROLE_SET = {code for code, _ in ROLE_CHOICES}


# ── Serializers ───────────────────────────────────────────────────────────────

class SheetRowSettingSerializer(serializers.ModelSerializer):
    """Read/write serializer for SheetRowSetting admin endpoint (v2).

    Read-only computed fields:
        id, field_key, updated_at, deleted_at, updated_by_name,
        triggered_user_id, triggered_user_name, triggered_user_active,
        triggered_roles (list of role codes from role_triggers),
        extra_users (list of active {id, name, is_active} from user_permissions),
        version (returned as-is; bumped by model.save()).

    Writable fields:
        display_order, is_visible, is_locked,
        label_tk/ru/en, description_tk/ru/en,
        style_width/align/color,
        triggered_user (FK id),
        triggered_roles (list of role codes — replaces all existing role_triggers),
        version (supplied for optimistic lock check; actual bump done in save()).
    """

    # Read-only derived
    updated_by_name = serializers.SerializerMethodField()
    triggered_user_name = serializers.SerializerMethodField()
    triggered_user_active = serializers.SerializerMethodField()
    triggered_roles = serializers.SerializerMethodField()
    extra_users = serializers.SerializerMethodField()

    # Write-only accepted for triggered_roles replacement
    triggered_roles_write = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True,
        source='_triggered_roles',
        help_text='List of role codes. Replaces all existing role_triggers.',
    )

    class Meta:
        model = SheetRowSetting
        fields = [
            # Identifiers (read-only)
            'id',
            'field_key',
            'row_number',
            # Display (writable)
            'display_order',
            'is_visible',
            'is_locked',
            # Labels (writable, Cyrillic-safe)
            'label_tk',
            'label_ru',
            'label_en',
            # Descriptions (writable, Cyrillic-safe)
            'description_tk',
            'description_ru',
            'description_en',
            # Style (writable)
            'style_width',
            'style_align',
            'style_color',
            # Permissions (partially writable)
            'triggered_user',
            'triggered_user_name',
            'triggered_user_active',
            'triggered_roles',
            'triggered_roles_write',
            'extra_users',
            # Concurrency / audit
            'version',
            'updated_at',
            'updated_by_name',
            'deleted_at',
        ]
        read_only_fields = [
            'id', 'field_key', 'row_number',
            'triggered_user_name', 'triggered_user_active',
            'triggered_roles', 'extra_users',
            'version',  # supplied by client for optimistic-lock check; never written via serializer
            'updated_at', 'updated_by_name', 'deleted_at',
        ]

    def get_updated_by_name(self, obj: SheetRowSetting) -> str | None:
        if not obj.updated_by_id:
            return None
        try:
            return obj.updated_by.username
        except Exception:
            return None

    def get_triggered_user_name(self, obj: SheetRowSetting) -> str | None:
        if obj.triggered_user_id is None:
            return None
        user = obj.triggered_user
        return user.get_full_name() or user.username

    def get_triggered_user_active(self, obj: SheetRowSetting) -> bool | None:
        if obj.triggered_user_id is None:
            return None
        return obj.triggered_user.is_active

    def get_triggered_roles(self, obj: SheetRowSetting) -> list[str]:
        """Return list of role codes from prefetched role_triggers."""
        return [rt.role for rt in obj.role_triggers.all()]

    def get_extra_users(self, obj: SheetRowSetting) -> list[dict]:
        """Return list of active user grants from prefetched user_permissions."""
        result = []
        for up in obj.user_permissions.all():
            if up.deleted_at is not None:
                continue
            result.append({
                'id': up.user_id,
                'name': (up.user.get_full_name() or up.user.username) if up.user_id else None,
                'is_active': up.user.is_active if up.user_id else None,
            })
        return result

    def validate_triggered_roles_write(self, value: list[str]) -> list[str]:
        """Validate each role code against ROLE_CHOICES."""
        invalid = [r for r in value if r not in _ROLE_SET]
        if invalid:
            raise serializers.ValidationError(
                f"Invalid role codes: {invalid}. Must be one of: {sorted(_ROLE_SET)}"
            )
        return value

    def validate_style_color(self, value: str) -> str:
        import re
        if value and not re.match(r'^#[0-9A-Fa-f]{6}$', value):
            raise serializers.ValidationError(
                'style_color must be a valid #RRGGBB hex string or empty.'
            )
        return value

    def validate_style_width(self, value: int | None) -> int | None:
        if value is not None and not (50 <= value <= 500):
            raise serializers.ValidationError('style_width must be between 50 and 500.')
        return value

    def update(self, instance: SheetRowSetting, validated_data: dict) -> SheetRowSetting:
        """Update instance. Handle triggered_roles replacement atomically."""
        new_roles = validated_data.pop('_triggered_roles', None)

        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()

            if new_roles is not None:
                # Replace all existing role triggers for this row atomically
                SheetRowRoleTrigger.objects.filter(row=instance).delete()
                if new_roles:
                    SheetRowRoleTrigger.objects.bulk_create(
                        [SheetRowRoleTrigger(row=instance, role=r) for r in new_roles],
                        batch_size=500,
                    )

        return instance


# ── ViewSet ───────────────────────────────────────────────────────────────────

class SheetRowSettingViewSet(viewsets.ModelViewSet):
    """Admin viewset for Sheet Row Settings (Sheet Control v2).

    Uses numeric ``id`` as the URL lookup (stable, never changes).
    ``field_key`` remains as the unique technical identifier.

    HTTP methods:
        GET    /admin/sheet-rows/                 — list
        GET    /admin/sheet-rows/{id}/            — retrieve
        PATCH  /admin/sheet-rows/{id}/            — update with version check
        DELETE /admin/sheet-rows/{id}/            — soft-delete
        POST   /admin/sheet-rows/{id}/restore/    — restore
        POST   /admin/sheet-rows/reorder/         — reorder display_order
        POST   /admin/sheet-rows/permissions/bulk/ — grant/revoke user exceptions

    Disabled: POST (create) — rows are seeded from DEFAULT_SHEET_ROWS only.

    Permission: IsAuthenticated + DynamicResourcePermission (resource_code='shipment').
    """

    resource_code = 'shipment'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SheetRowSettingSerializer
    lookup_field = 'id'
    lookup_value_regex = r'\d+'
    http_method_names = ['get', 'patch', 'delete', 'head', 'options', 'post']

    def get_queryset(self):
        include_deleted = self.request.query_params.get('include_deleted', '0')
        if include_deleted == '1':
            base_qs = SheetRowSetting.objects.all()
        else:
            base_qs = SheetRowSetting.objects.active()
        return base_qs.select_related(
            'triggered_user', 'updated_by',
        ).prefetch_related(
            'role_triggers',
            'user_permissions__user',
        )

    def list(self, request, *args, **kwargs):
        """GET /admin/sheet-rows/ — list rows, auto-provision missing entries."""
        self._provision_missing_rows()
        qs = self.get_queryset().order_by('display_order')
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        """GET /admin/sheet-rows/{id}/ — single row."""
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        """POST is disabled — rows are seeded from DEFAULT_SHEET_ROWS."""
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def update(self, request, *args, **kwargs):
        """Full PUT is disabled — use PATCH."""
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def partial_update(self, request, *args, **kwargs):
        """PATCH /admin/sheet-rows/{id}/ — update with optimistic version check.

        Body may include ``version`` matching the current instance version.
        Mismatch → 409 Conflict with current_version in body.
        """
        instance = self.get_object()

        # Optimistic lock check (ADR-0006) — version is REQUIRED on every PATCH.
        # Making it optional would let clients silently bypass the lock and overwrite
        # concurrent edits, defeating the protocol. The frontend hook always sends it.
        supplied_version = request.data.get('version')
        if supplied_version is None:
            return Response(
                {'error': 'version is required for updates.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            supplied_version = int(supplied_version)
        except (ValueError, TypeError):
            return Response(
                {'error': 'version must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if supplied_version != instance.version:
            return Response(
                {
                    'error': 'version_conflict',
                    'current_version': instance.version,
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self._perform_update_with_audit(instance, serializer)

        # Re-fetch with prefetch for accurate response
        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        """DELETE /admin/sheet-rows/{id}/ — soft-delete.

        Pre-condition: row must have is_visible=False and updated_at > 30 days ago.
        """
        instance = self.get_object()

        if instance.deleted_at is not None:
            return Response(
                {'error': 'Row is already soft-deleted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if instance.is_visible:
            return Response(
                {'error': 'row_must_be_hidden_30_days'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check the row has been hidden for ≥30 days
        threshold = timezone.now() - timedelta(days=30)
        if instance.updated_at > threshold:
            return Response(
                {'error': 'row_must_be_hidden_30_days'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        instance.deleted_at = now
        instance.deleted_by = request.user
        instance.save()

        AuditLog.objects.create(
            user=request.user,
            action='delete',
            model_name='SheetRowSetting',
            object_id=instance.id,
            object_repr=str(instance),
            field_name='deleted_at',
            old_value='None',
            new_value=now.isoformat(),
            detail=f'Soft-deleted: {instance.field_key}',
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request, id=None):
        """POST /admin/sheet-rows/{id}/restore/ — restore soft-deleted row.

        Uses the unfiltered queryset so soft-deleted rows are reachable by id.
        """
        # Bypass get_queryset() (which calls active()) to include soft-deleted rows
        try:
            instance = SheetRowSetting.objects.get(pk=self.kwargs['id'])
        except SheetRowSetting.DoesNotExist:
            return Response(
                {'error': 'No SheetRowSetting matches the given query.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if instance.deleted_at is None:
            return Response(
                {'error': 'Row is not soft-deleted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_deleted_at = instance.deleted_at
        instance.deleted_at = None
        instance.deleted_by = None
        instance.save()

        AuditLog.objects.create(
            user=request.user,
            action='update',
            model_name='SheetRowSetting',
            object_id=instance.id,
            object_repr=str(instance),
            field_name='deleted_at',
            old_value=old_deleted_at.isoformat() if old_deleted_at else 'None',
            new_value='None',
            detail=f'Restored: {instance.field_key}',
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        """POST /admin/sheet-rows/reorder/ — sparse display_order reorder.

        Body: {"order": [id, id, ...]}

        Assigns new display_order values as (position+1) * 1024.
        Writes a single AuditLog row summarising the reorder.
        """
        order_ids = request.data.get('order', [])
        if not order_ids:
            return Response(
                {'error': 'order must be a non-empty list of ids.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            order_ids = [int(i) for i in order_ids]
        except (ValueError, TypeError):
            return Response(
                {'error': 'order must be a list of integer ids.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            rows_by_id = {
                r.id: r
                for r in SheetRowSetting.objects.active().filter(id__in=order_ids)
            }
            ordered_rows = [rows_by_id[i] for i in order_ids if i in rows_by_id]
            if not ordered_rows:
                return Response(
                    {'error': 'No valid row ids found.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for idx, row in enumerate(ordered_rows):
                row.display_order = (idx + 1) * 1024

            SheetRowSetting.objects.bulk_update(ordered_rows, ['display_order'], batch_size=500)

        AuditLog.objects.create(
            user=request.user,
            action='update',
            model_name='SheetRowSetting',
            object_id=0,
            object_repr='reorder',
            field_name='display_order',
            old_value='',
            new_value=','.join(str(i) for i in order_ids),
            detail=f'Reordered {len(ordered_rows)} rows by admin.',
        )
        return Response({'reordered': len(ordered_rows)})

    @action(detail=False, methods=['post'], url_path='permissions/bulk')
    def permissions_bulk(self, request):
        """POST /admin/sheet-rows/permissions/bulk/ — grant/revoke user exceptions.

        Body: {"row_id": int, "grants": [user_id, ...], "revokes": [user_id, ...]}

        Grants: update_or_create — restores soft-deleted row if it exists.
        Revokes: soft-delete (set deleted_at + deleted_by).
        Idempotent for both operations.
        """
        row_id = request.data.get('row_id')
        grants = request.data.get('grants', [])
        revokes = request.data.get('revokes', [])

        if not row_id:
            return Response(
                {'error': 'row_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            row = SheetRowSetting.objects.get(pk=row_id)
        except SheetRowSetting.DoesNotExist:
            return Response(
                {'error': f'SheetRowSetting {row_id} not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = timezone.now()

        with transaction.atomic():
            for user_id in grants:
                obj, created = SheetRowUserPermission.objects.get_or_create(
                    row=row,
                    user_id=user_id,
                    defaults={'can_edit': True, 'created_by': request.user},
                )
                if not created and obj.deleted_at is not None:
                    # Restore previously soft-deleted grant
                    obj.deleted_at = None
                    obj.deleted_by = None
                    obj.save()
                AuditLog.objects.create(
                    user=request.user,
                    action='create',
                    model_name='SheetRowUserPermission',
                    object_id=obj.id,
                    object_repr=str(obj),
                    field_name='user_id',
                    old_value='None',
                    new_value=str(user_id),
                    detail=f'Granted user {user_id} on row {row.field_key}',
                )

            for user_id in revokes:
                updated = SheetRowUserPermission.objects.filter(
                    row=row, user_id=user_id, deleted_at__isnull=True,
                ).update(deleted_at=now, deleted_by=request.user)
                if updated:
                    AuditLog.objects.create(
                        user=request.user,
                        action='delete',
                        model_name='SheetRowUserPermission',
                        object_id=0,
                        object_repr=f'row={row.field_key} user={user_id}',
                        field_name='user_id',
                        old_value=str(user_id),
                        new_value='None',
                        detail=f'Revoked user {user_id} on row {row.field_key}',
                    )

        return Response({'granted': len(grants), 'revoked': len(revokes)})

    # ── Private helpers ────────────────────────────────────────────────────

    def _provision_missing_rows(self) -> None:
        """Create SheetRowSetting entries for DEFAULT_SHEET_ROWS rows not in DB.

        First-call cost: 1 SELECT + 1 bulk_create. Steady-state cost: 1 SELECT
        (the bulk_create is skipped when nothing is missing). Replaces the
        prior per-row get_or_create loop, which fired ~37 SELECTs on every
        admin page load even after all rows were already provisioned.
        """
        existing_keys = set(
            SheetRowSetting.objects.values_list('field_key', flat=True)
        )
        missing = [r for r in DEFAULT_SHEET_ROWS if r['field_key'] not in existing_keys]
        if not missing:
            return
        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=r['field_key'],
                    row_number=r['row_number'],
                    display_order=r['row_number'] * 1024,
                )
                for r in missing
            ],
            batch_size=500,
            ignore_conflicts=True,
        )

    def _perform_update_with_audit(
        self,
        instance: SheetRowSetting,
        serializer: SheetRowSettingSerializer,
    ) -> None:
        """Save the serializer and write per-field AuditLog rows for changed fields."""
        tracked_fields = [
            'is_visible', 'is_locked', 'display_order',
            'label_tk', 'label_ru', 'label_en',
            'description_tk', 'description_ru', 'description_en',
            'style_width', 'style_align', 'style_color',
            'triggered_user_id',
        ]
        old_values = {f: getattr(instance, f) for f in tracked_fields}
        old_roles = list(instance.role_triggers.values_list('role', flat=True))

        instance = serializer.save(updated_by=self.request.user)

        new_values = {f: getattr(instance, f) for f in tracked_fields}
        new_roles = list(instance.role_triggers.values_list('role', flat=True))
        object_repr = str(instance)

        for field in tracked_fields:
            old_val = str(old_values[field]) if old_values[field] is not None else 'None'
            new_val = str(new_values[field]) if new_values[field] is not None else 'None'
            if old_val != new_val:
                AuditLog.objects.create(
                    user=self.request.user,
                    action='update',
                    model_name='SheetRowSetting',
                    object_id=instance.id,
                    object_repr=object_repr,
                    field_name=field,
                    old_value=old_val,
                    new_value=new_val,
                    detail=f"{field}: '{old_val}' → '{new_val}'",
                )

        old_roles_str = ','.join(sorted(old_roles))
        new_roles_str = ','.join(sorted(new_roles))
        if old_roles_str != new_roles_str:
            AuditLog.objects.create(
                user=self.request.user,
                action='update',
                model_name='SheetRowSetting',
                object_id=instance.id,
                object_repr=object_repr,
                field_name='triggered_roles',
                old_value=old_roles_str,
                new_value=new_roles_str,
                detail=f"triggered_roles: '{old_roles_str}' → '{new_roles_str}'",
            )
