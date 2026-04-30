"""Admin-facing viewsets for notifications, audit log, and settings CRUD.

Endpoints:
  GET/PATCH /api/v1/export/notifications/              — own notifications
  POST      /api/v1/export/notifications/read_all/     — mark all read
  POST      /api/v1/export/notifications/{id}/read/    — mark one read

  GET       /api/v1/export/audit-log/                  — transition history (admin/director/export_manager)

  GET/POST/PATCH/DELETE /api/v1/export/admin/seasons/  — Season CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/firms/         — ExportFirm CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/import-firms/  — ImportFirm CRUD (resource-permission gated)
  GET/POST/PATCH/DELETE /api/v1/export/admin/users/    — User CRUD (admin/superuser; POST/DELETE superuser only)
  PUT             /api/v1/export/admin/users/{pk}/permissions/   — Grant export permissions (admin only)

See AD-15 for the admin / director separation rationale.
"""
import logging

from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.core.models import ExportFirm, ImportFirm, Season, User
from apps.core.permissions import firm_write_permission, write_permission, DynamicResourcePermission
from apps.core.roles import ADMIN_ONLY, AUDIT_VIEWERS, PRIVILEGED_ROLES as _PRIVILEGED_ROLES
from apps.export.models import AuditLog, Notification, TruckSplitDefault, invalidate_truck_split_cache

logger = logging.getLogger(__name__)

# System-administration gates: only admin (or is_superuser) can change user
# roles or manage user permissions. Director/EM lost these powers in AD-15.
_ADMIN_ONLY = ADMIN_ONLY
# User-list visibility — admin always; EM keeps it for the comments/mentions UX.
_ADMIN_MANAGER = frozenset({'admin', 'export_manager'})


def _require_role(user, allowed: frozenset, verb: str = 'perform this action') -> None:
    """Raise PermissionDenied unless user.role is in allowed."""
    if getattr(user, 'role', None) not in allowed:
        raise PermissionDenied(f"Role '{user.role}' is not allowed to {verb}.")


def _require_superuser(user, verb: str = 'perform this action') -> None:
    """Raise PermissionDenied unless the user is a superuser."""
    if not getattr(user, 'is_superuser', False):
        raise PermissionDenied(f"Superuser privileges are required to {verb}.")


# ---------------------------------------------------------------------------
# Serializers (inline — kept here to avoid a separate file for admin-only shapes)
# ---------------------------------------------------------------------------

class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ['id', 'kind', 'message', 'link', 'read_at', 'is_read', 'created_at']
        read_only_fields = fields

    def get_is_read(self, obj: Notification) -> bool:
        return obj.read_at is not None


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'user', 'user_name', 'action', 'model_name',
            'object_id', 'object_repr', 'detail', 'created_at',
        ]
        read_only_fields = fields

    def get_user_name(self, obj: AuditLog) -> str | None:
        if obj.user_id is None:
            return None
        return getattr(obj.user, 'username', None)


class SeasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Season
        fields = ['id', 'name', 'start_date', 'end_date', 'is_active']


class ExportFirmSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportFirm
        fields = [
            'id', 'code', 'name_tk', 'name_en', 'name_ru',
            'address_tk', 'address_en', 'address_ru',
            'bank_details_tk', 'bank_details_en', 'bank_details_ru',
            'director', 'tax_code', 'swift_code', 'one_c_code',
            'is_active', 'is_gapy_satys',
        ]


class TruckSplitDefaultSerializer(serializers.ModelSerializer):
    """CRUD shape for the official kg-per-firm export-doc lookup table."""
    updated_by_name = serializers.CharField(source='updated_by.username', read_only=True, default=None)

    class Meta:
        model = TruckSplitDefault
        fields = ['id', 'num_firms', 'kg_per_firm', 'notes', 'updated_at', 'updated_by_name']
        read_only_fields = ['id', 'updated_at', 'updated_by_name']

    def validate_num_firms(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError('num_firms must be >= 1')
        return value

    def validate_kg_per_firm(self, value):
        if value <= 0:
            raise serializers.ValidationError('kg_per_firm must be > 0')
        return value


class ImportFirmSerializer(serializers.ModelSerializer):
    country_name = serializers.CharField(source='country.name_en', read_only=True, default=None)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)

    class Meta:
        model = ImportFirm
        fields = [
            'id', 'code', 'name_company', 'name_short',
            'country', 'country_name', 'city', 'city_name',
            'address', 'bank_details', 'contact_person', 'phone',
            'director_signature', 'director_seal', 'is_active', 'is_gapy_satys',
        ]


class UserListSerializer(serializers.ModelSerializer):
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'is_active', 'is_superuser', 'phone', 'permissions']
        # is_superuser is always read-only — it is managed at the DB / Django-admin level.
        read_only_fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_superuser', 'phone', 'permissions']

    def get_permissions(self, obj: User) -> list[str]:
        """Return custom export/core permission codenames for the user."""
        return list(
            obj.user_permissions.filter(
                content_type__app_label__in=['export', 'core'],
            ).values_list('codename', flat=True)
        )


class UserPatchSerializer(serializers.ModelSerializer):
    """Only role and is_active may be patched. Admin-only via partial_update gate (AD-15)."""

    class Meta:
        model = User
        fields = ['role', 'is_active']


# ---------------------------------------------------------------------------
# Viewsets
# ---------------------------------------------------------------------------

class NotificationViewSet(ReadOnlyModelViewSet):
    """Authenticated user sees only their own notifications.

    GET  /api/v1/export/notifications/           — list (supports ?unread=true)
    GET  /api/v1/export/notifications/{id}/      — detail
    POST /api/v1/export/notifications/read_all/  — mark all as read
    POST /api/v1/export/notifications/{id}/read/ — mark one as read
    """

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        if self.request.query_params.get('unread', '').lower() == 'true':
            qs = qs.filter(read_at__isnull=True)
        return qs

    @action(detail=False, methods=['post'], url_path='read_all')
    def read_all(self, request):
        """POST /api/v1/export/notifications/read_all/ — mark every unread notification read."""
        now = timezone.now()
        updated = Notification.objects.filter(
            user=request.user,
            read_at__isnull=True,
        ).update(read_at=now)
        return Response({'marked_read': updated})

    @action(detail=True, methods=['post'], url_path='read')
    def read(self, request, pk=None):
        """POST /api/v1/export/notifications/{id}/read/ — mark a single notification read."""
        notification = self.get_object()
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=['read_at'])
        serializer = self.get_serializer(notification)
        return Response(serializer.data)


class AuditLogViewSet(ReadOnlyModelViewSet):
    """Read-only audit trail.

    Accessible to admin, director, and export_manager (AUDIT_VIEWERS — AD-15).

    GET /api/v1/export/audit-log/          — list (filter ?model_name=&action=&object_id=)
    GET /api/v1/export/audit-log/{id}/     — detail
    """

    permission_classes = [IsAuthenticated]
    serializer_class = AuditLogSerializer

    queryset = AuditLog.objects.select_related('user').order_by('-created_at')

    def check_permissions(self, request):
        super().check_permissions(request)
        _require_role(request.user, AUDIT_VIEWERS, 'view audit logs')

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user').order_by('-created_at')
        params = self.request.query_params
        if model_name := params.get('model_name'):
            qs = qs.filter(model_name=model_name)
        if action_val := params.get('action'):
            qs = qs.filter(action=action_val)
        if object_id := params.get('object_id'):
            try:
                qs = qs.filter(object_id=int(object_id))
            except (ValueError, TypeError):
                pass
        return qs


class SeasonViewSet(ModelViewSet):
    """Season CRUD.

    All authenticated users may list/retrieve.
    Writes gated dynamically on resource_code='season' (RoleResourcePermission).
    Per default seed: admin / director / export_manager have full CRUD.

    GET    /api/v1/export/admin/seasons/       — list
    GET    /api/v1/export/admin/seasons/{id}/  — detail
    POST   /api/v1/export/admin/seasons/       — create
    PATCH  /api/v1/export/admin/seasons/{id}/  — update
    DELETE /api/v1/export/admin/seasons/{id}/  — delete
    """

    resource_code = 'season'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SeasonSerializer
    queryset = Season.objects.all().order_by('-start_date')


class TruckSplitDefaultViewSet(ModelViewSet):
    """TruckSplitDefault CRUD — official kg-per-firm by # of firms on a truck.

    Write access gated dynamically on resource_code='truck_split_default'.
    Per default seed: admin and director have full CRUD; export_manager is
    read-only (Gap 7 / ADR-016). The values feed `get_default_truck_weight()`
    which is used by `set_firm_splits` to fill `ShipmentFirmSplit.weight_kg`
    and auto-create draft `QuotaUsageRecord` rows.

    Permission: gated dynamically on resource_code='truck_split_default'.

    GET    /api/v1/export/admin/truck-splits/       — list
    GET    /api/v1/export/admin/truck-splits/{id}/  — detail
    POST   /api/v1/export/admin/truck-splits/       — create
    PATCH  /api/v1/export/admin/truck-splits/{id}/  — update
    DELETE /api/v1/export/admin/truck-splits/{id}/  — delete
    """

    resource_code = 'truck_split_default'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = TruckSplitDefaultSerializer
    queryset = TruckSplitDefault.objects.all().order_by('num_firms')

    def perform_create(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        invalidate_truck_split_cache(instance.num_firms)

    def perform_update(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        invalidate_truck_split_cache(instance.num_firms)

    def perform_destroy(self, instance):
        n = instance.num_firms
        instance.delete()
        invalidate_truck_split_cache(n)


class ExportFirmViewSet(ModelViewSet):
    """ExportFirm CRUD.

    All authenticated users may list/retrieve.
    Writes gated dynamically on resource_code='export_firm' (RoleResourcePermission).
    Per default seed: admin / director / export_manager have full CRUD.

    GET    /api/v1/export/admin/firms/       — list
    GET    /api/v1/export/admin/firms/{id}/  — detail
    POST   /api/v1/export/admin/firms/       — create
    PATCH  /api/v1/export/admin/firms/{id}/  — update
    DELETE /api/v1/export/admin/firms/{id}/  — delete
    """

    resource_code = 'export_firm'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ExportFirmSerializer
    queryset = ExportFirm.objects.all().order_by('name_en')


class ImportFirmViewSet(ModelViewSet):
    """ImportFirm CRUD.

    All authenticated users may list/retrieve.
    Writes gated dynamically on resource_code='import_firm' (RoleResourcePermission).
    Per default seed: admin / director / export_manager have full CRUD.

    GET    /api/v1/export/admin/import-firms/       — list
    GET    /api/v1/export/admin/import-firms/{id}/  — detail
    POST   /api/v1/export/admin/import-firms/       — create
    PATCH  /api/v1/export/admin/import-firms/{id}/  — update
    DELETE /api/v1/export/admin/import-firms/{id}/  — delete
    """

    resource_code = 'import_firm'
    parser_classes = [MultiPartParser, JSONParser]
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ImportFirmSerializer
    queryset = ImportFirm.objects.select_related('country', 'city').order_by('name_company')


class UserManagementViewSet(ModelViewSet):
    """User management — admin-only for mutations (AD-15).

    List and retrieve: admin or export_manager (or superuser) — EM keeps visibility for the comments/mentions UX.
    PATCH role/is_active: admin only (or superuser). Last-admin guard in perform_update.
    POST create user: superuser only.
    DELETE user: superuser only (self-deletion blocked).
    POST set-password: superuser only.

    GET    /api/v1/export/admin/users/                       — list all users
    GET    /api/v1/export/admin/users/{id}/                  — detail
    PATCH  /api/v1/export/admin/users/{id}/                  — update role + is_active (admin/superuser)
    POST   /api/v1/export/admin/users/                       — create user (superuser only)
    DELETE /api/v1/export/admin/users/{id}/                  — delete user (superuser only)
    POST   /api/v1/export/admin/users/{id}/set-password/     — change password (superuser only)
    """

    # Drop write_permission from the class level — each mutating method enforces
    # its own role/superuser guard inline, allowing superusers with any role to
    # pass through without being blocked by the write_permission role check.
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        if not user.is_superuser:
            _require_role(user, _ADMIN_MANAGER, 'view user list')
        return User.objects.prefetch_related('user_permissions').order_by('username')

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            return UserPatchSerializer
        return UserListSerializer

    def partial_update(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            _require_role(request.user, _ADMIN_ONLY, 'update user roles')
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def perform_update(self, serializer):
        # Last-admin guard: prevent removing the only active admin from the system.
        # Blocks (1) admin demoting themselves and (2) admin demoting/deactivating
        # another admin while no other active admin exists. Promoting freely is OK.
        # Runs AFTER serializer.is_valid() so DRF has coerced is_active from any
        # truthy/falsy payload shape ("false", 0, "no") to a real bool — checking
        # request.data.is_active before validation is unsafe.
        #
        # Wrapped in transaction.atomic() with select_for_update() to close the
        # TOCTOU window: two concurrent PATCH requests demoting two different
        # admins could otherwise each observe other_admins=1 and both succeed,
        # leaving zero active admins. Locking the candidate rows for the count
        # prevents that.
        from django.db import transaction

        target_user = serializer.instance
        validated = serializer.validated_data
        new_role = validated.get('role', target_user.role)
        new_active = validated.get('is_active', target_user.is_active)
        demoting_admin = (
            target_user.role == 'admin'
            and (new_role != 'admin' or new_active is False)
        )
        with transaction.atomic():
            if demoting_admin:
                other_admins = (
                    User.objects
                    .select_for_update()
                    .filter(role='admin', is_active=True)
                    .exclude(id=target_user.id)
                    .count()
                )
                if other_admins == 0:
                    raise PermissionDenied(
                        'Cannot demote or deactivate the last active admin. '
                        'Promote another user to admin first.'
                    )
            serializer.save()

    def create(self, request):
        """POST /api/v1/export/admin/users/ — create a new platform user.

        Superuser only. Password is write-only and is NEVER returned in any
        response. Django's create_user() is used so the password is hashed.

        Required fields: username, password, role.
        Optional fields: first_name, last_name, email, phone, is_active.
        """
        _require_superuser(request.user, 'create users')

        username = request.data.get('username', '').strip()
        password = request.data.get('password', '')
        role = request.data.get('role', '').strip()

        errors: dict[str, list[str]] = {}

        if not username:
            errors['username'] = ['This field is required.']
        elif User.objects.filter(username=username).exists():
            errors['username'] = [f"Username '{username}' is already taken."]

        if not password:
            errors['password'] = ['This field is required.']

        if not role:
            errors['role'] = ['This field is required.']

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        new_user = User.objects.create_user(
            username=username,
            password=password,
            role=role,
            first_name=request.data.get('first_name', ''),
            last_name=request.data.get('last_name', ''),
            email=request.data.get('email', ''),
            phone=request.data.get('phone') or None,
            is_active=bool(request.data.get('is_active', True)),
        )
        serializer = UserListSerializer(new_user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        """DELETE /api/v1/export/admin/users/{id}/ — permanently delete a user.

        Superuser only. Self-deletion is blocked to prevent accidental lockout.
        """
        _require_superuser(request.user, 'delete users')

        try:
            target_pk = int(pk)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid user id.'}, status=status.HTTP_400_BAD_REQUEST)

        if target_pk == request.user.id:
            return Response(
                {'error': 'Cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance = self.get_object()
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='set-password')
    def set_password(self, request, pk=None):
        """POST /api/v1/export/admin/users/{id}/set-password/ — set a user's password.

        Superuser only. The password is NEVER echoed back in the response.

        Request body: { "password": "<new_password>" }
        Response:     { "detail": "Password updated." }
        """
        _require_superuser(request.user, 'set passwords')

        new_password = request.data.get('password', '')
        if not new_password:
            return Response(
                {'password': ['This field is required.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(new_password) < 8:
            return Response(
                {'password': ['Password must be at least 8 characters.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_user = self.get_object()
        target_user.set_password(new_password)
        target_user.save(update_fields=['password'])
        return Response({'detail': 'Password updated.'}, status=status.HTTP_200_OK)




# ---------------------------------------------------------------------------
# User export-permission management
# ---------------------------------------------------------------------------

class UserPermissionsView(APIView):
    """Grant or replace a user's custom export-app Django permissions.

    PUT /api/v1/export/admin/users/{pk}/permissions/

    Request body:
        { "permissions": ["add_weeklyharvestplan", "change_weeklyharvestplan"] }

    Response:
        { "permissions": ["add_weeklyharvestplan", "change_weeklyharvestplan"] }

    Clears all existing export-app custom permissions for the user, then grants
    the provided codenames. Only codenames that exist in the export app are
    accepted; unknown codenames cause a 400 error.
    """

    permission_classes = [IsAuthenticated]

    def put(self, request, pk: int):
        """Replace the target user's export permissions with the supplied list."""
        _require_role(request.user, _ADMIN_ONLY, 'manage user permissions')

        try:
            target_user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({'error': f'User {pk} not found.'}, status=status.HTTP_404_NOT_FOUND)

        raw_codenames = request.data.get('permissions', [])
        if not isinstance(raw_codenames, list):
            raise ValidationError({'permissions': 'Must be a list of permission codenames.'})

        # Fetch all valid export-app and core-app permissions in a single query.
        # core-app permissions cover ExportFirm and ImportFirm model permissions.
        export_ct = ContentType.objects.filter(app_label__in=['export', 'core'])
        valid_perms = {
            p.codename: p
            for p in Permission.objects.filter(content_type__in=export_ct)
        }

        # Validate every supplied codename before making any changes.
        unknown = [c for c in raw_codenames if c not in valid_perms]
        if unknown:
            raise ValidationError(
                {'permissions': f"Unknown permission codenames: {unknown}"}
            )

        granted_perms = [valid_perms[c] for c in raw_codenames]

        # Clear existing export-app user permissions, then add the new set.
        current_export_perms = target_user.user_permissions.filter(content_type__in=export_ct)
        target_user.user_permissions.remove(*current_export_perms)
        if granted_perms:
            target_user.user_permissions.add(*granted_perms)

        return Response({'permissions': list(raw_codenames)})
