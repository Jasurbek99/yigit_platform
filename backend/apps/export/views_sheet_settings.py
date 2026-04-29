"""Admin viewset for configuring the per-row trigger rules in the Shipment Sheet.

Endpoint:
  GET   /api/v1/export/admin/sheet-rows/                — list all rows (auto-creates
        missing SheetRowSetting entries from DEFAULT_SHEET_ROWS on first access)
  PATCH /api/v1/export/admin/sheet-rows/{field_key}/    — update triggered_role or
        triggered_user for a single row

POST and DELETE are intentionally disabled. Settings are auto-provisioned from
``DEFAULT_SHEET_ROWS``; they are never manually created or deleted via the API.

Permission gate: same ``canDo(user, 'shipment', 'edit')`` logic used by the
sibling admin tabs (Seasons, Firms, Truck Splits). Implemented via
``DynamicResourcePermission`` with ``resource_code = 'shipment'``.

Per the D5 parity check in the plan: export_manager currently has shipment.edit
permission, so this gate allows export_managers to configure trigger rules. A
follow-up ticket ("Tighten admin tab gates to director-only") should address this
if needed. Do not widen scope here.
"""
import logging

from rest_framework import serializers, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models.user import ROLE_CHOICES
from apps.core.permissions import DynamicResourcePermission
from apps.export.models import AuditLog, SheetRowSetting
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

logger = logging.getLogger(__name__)


class SheetRowSettingSerializer(serializers.ModelSerializer):
    """Serializer for SheetRowSetting admin endpoint.

    XOR strategy — auto-clear (preferred per plan D3):
    When a PATCH sets ``triggered_role``, ``triggered_user`` is auto-cleared to
    null. When a PATCH sets ``triggered_user``, ``triggered_role`` is auto-cleared
    to ``''``. This avoids strict validation errors and gives the admin a smoother
    experience: "you picked role, I cleared the user you had set."

    The DB-level CheckConstraint (``sheet_row_setting_role_xor_user``) is the
    safety net in case a race condition or bypass attempt slips through.

    Read-only fields:
        field_key, row_number, triggered_user_name, triggered_user_active,
        updated_at, updated_by_name.

    Writable fields:
        triggered_role, triggered_user (FK id).
    """

    triggered_user_name = serializers.SerializerMethodField(
        help_text='Display name of triggered_user (full name or username). Null if no user set.',
    )
    triggered_user_active = serializers.SerializerMethodField(
        help_text='True/False reflecting triggered_user.is_active. Null if no user set (D7).',
    )
    updated_by_name = serializers.SerializerMethodField(
        help_text='Username of the user who last updated this row.',
    )
    default_who_key = serializers.SerializerMethodField(
        help_text='i18n key for the default "Who" label (e.g. "sheet.who.logist"). Read-only.',
    )

    class Meta:
        model = SheetRowSetting
        fields = [
            'field_key',         # read-only (unique identifier)
            'row_number',        # read-only (display ordinal)
            'default_who_key',   # read-only derived from DEFAULT_SHEET_ROWS
            'triggered_role',    # writable
            'triggered_user',    # writable FK id
            'triggered_user_name',    # read-only derived
            'triggered_user_active',  # read-only derived (D7)
            'updated_at',        # read-only auto_now
            'updated_by_name',   # read-only derived
        ]
        read_only_fields = [
            'field_key', 'row_number', 'default_who_key',
            'triggered_user_name', 'triggered_user_active',
            'updated_at', 'updated_by_name',
        ]

    def get_default_who_key(self, obj: SheetRowSetting) -> str | None:
        """Return the i18n key for the default 'Who' label for this row.

        Looks up ``field_key`` in ``DEFAULT_SHEET_ROWS`` (the canonical list).
        Returns None only if the row is somehow absent from the default list,
        which should not happen in production.
        """
        for row in DEFAULT_SHEET_ROWS:
            if row['field_key'] == obj.field_key:
                return row.get('default_who_key')
        return None

    def get_triggered_user_name(self, obj: SheetRowSetting) -> str | None:
        """Return full name or username of triggered_user, or None if unset."""
        if obj.triggered_user_id is None:
            return None
        user = obj.triggered_user
        return user.get_full_name() or user.username

    def get_triggered_user_active(self, obj: SheetRowSetting) -> bool | None:
        """Return triggered_user.is_active, or None if no user is set (D7)."""
        if obj.triggered_user_id is None:
            return None
        return obj.triggered_user.is_active

    def get_updated_by_name(self, obj: SheetRowSetting) -> str | None:
        """Return username of the user who last updated this row, or None."""
        if not obj.updated_by_id:
            return None
        # updated_by might not be select_related — avoid AttributeError
        try:
            return obj.updated_by.username
        except Exception:
            return None

    def validate(self, data: dict) -> dict:
        """Apply auto-clear XOR strategy for triggered_role / triggered_user.

        When both arrive in the same PATCH body (e.g. Postman), raise a
        ValidationError — the API consumer must send only one. When only one
        arrives, the other is auto-cleared so the DB constraint is satisfied.
        """
        has_role = 'triggered_role' in data
        has_user = 'triggered_user' in data

        # Strict error only when the client explicitly sends BOTH non-empty values
        if has_role and has_user:
            new_role = data.get('triggered_role') or ''
            new_user = data.get('triggered_user')
            if new_role and new_user is not None:
                raise serializers.ValidationError({
                    'non_field_errors': [
                        "Set either 'triggered_role' or 'triggered_user', not both. "
                        "For shared duties, assign by role instead of listing specific users."
                    ]
                })

        # Auto-clear: if only triggered_role arrives, clear triggered_user and vice versa
        if has_role and not has_user:
            data['triggered_user'] = None
        if has_user and not has_role:
            data['triggered_role'] = ''

        return data


class SheetRowSettingViewSet(viewsets.ModelViewSet):
    """Admin viewset for the per-row trigger configuration in the Shipment Sheet.

    Uses ``field_key`` as the URL lookup (not the numeric ``id`` PK) so the admin
    tab can address rows by stable semantic key rather than auto-increment.

    HTTP methods:
        GET    /admin/sheet-rows/                — list all rows, auto-provisions missing ones
        PATCH  /admin/sheet-rows/{field_key}/    — update trigger config

    Disabled:
        POST, DELETE — settings are auto-provisioned from DEFAULT_SHEET_ROWS and
        must not be created or deleted via the API.

    Permission:
        Reads: any authenticated user with shipment.view (DynamicResourcePermission).
        Writes: authenticated user with shipment.edit (DynamicResourcePermission).
        This matches the parity of sibling admin tabs (D5). A follow-up ticket
        should tighten the write gate to director-only if export_manager access
        to trigger-rule editing is deemed a security hole.
    """

    resource_code = 'shipment'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SheetRowSettingSerializer
    lookup_field = 'field_key'
    lookup_value_regex = r'[\w-]+'
    # Disable POST and DELETE — settings are auto-provisioned, never manually created/deleted
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        return SheetRowSetting.objects.select_related('triggered_user', 'updated_by').order_by('row_number')

    def list(self, request, *args, **kwargs):
        """GET /admin/sheet-rows/ — list all rows.

        Auto-provisions any ``SheetRowSetting`` entries missing from the DB for
        rows defined in ``DEFAULT_SHEET_ROWS``. This is the lazy-creation strategy:
        on first ever GET, all 43 rows are created. Subsequent GETs are just reads.

        ``get_or_create`` is idempotent and safe for concurrent requests — the
        unique constraint on ``field_key`` prevents duplicates.
        """
        for row in DEFAULT_SHEET_ROWS:
            SheetRowSetting.objects.get_or_create(
                field_key=row['field_key'],
                defaults={'row_number': row['row_number']},
            )

        qs = self.get_queryset()
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def perform_update(self, serializer: SheetRowSettingSerializer) -> None:
        """Override to write AuditLog rows for each changed field (plan D6).

        Captures the OLD values before ``save()``, then compares after. One
        AuditLog row per changed field (``triggered_role`` and ``triggered_user``).
        Uses individual ``create()`` calls instead of ``bulk_create()`` because
        at most two rows can be produced — the overhead of an extra query is
        negligible and avoids the batch_size ceremony for a 2-row write.
        """
        instance = serializer.instance
        old_role = instance.triggered_role or ''
        old_user_id = instance.triggered_user_id
        old_user_repr = str(instance.triggered_user) if instance.triggered_user_id else 'None'

        instance = serializer.save(updated_by=self.request.user)

        new_role = instance.triggered_role or ''
        new_user_id = instance.triggered_user_id
        new_user_repr = str(instance.triggered_user) if instance.triggered_user_id else 'None'
        object_repr = f'R{instance.row_number} {instance.field_key}'

        if old_role != new_role:
            AuditLog.objects.create(
                user=self.request.user,
                action='update',
                model_name='SheetRowSetting',
                object_id=instance.id,
                object_repr=object_repr,
                field_name='triggered_role',
                old_value=old_role,
                new_value=new_role,
                detail=f"triggered_role: '{old_role}' → '{new_role}'",
            )

        if old_user_repr != new_user_repr:
            AuditLog.objects.create(
                user=self.request.user,
                action='update',
                model_name='SheetRowSetting',
                object_id=instance.id,
                object_repr=object_repr,
                field_name='triggered_user',
                old_value=old_user_repr,
                new_value=new_user_repr,
                detail=f"triggered_user: '{old_user_repr}' → '{new_user_repr}'",
            )
