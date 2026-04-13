"""Admin-facing viewsets for notifications, audit log, and settings CRUD.

Endpoints:
  GET/PATCH /api/v1/export/notifications/              — own notifications
  POST      /api/v1/export/notifications/read_all/     — mark all read
  POST      /api/v1/export/notifications/{id}/read/    — mark one read

  GET       /api/v1/export/audit-log/                  — transition history (director/export_manager)

  GET/POST/PATCH/DELETE /api/v1/export/admin/seasons/  — Season CRUD (director writes)
  GET/POST/PATCH/DELETE /api/v1/export/admin/firms/         — ExportFirm CRUD (director writes)
  GET/POST/PATCH/DELETE /api/v1/export/admin/import-firms/  — ImportFirm CRUD (director writes)
  GET/POST/PATCH/DELETE /api/v1/export/admin/users/    — User CRUD (director/superuser; POST/DELETE superuser only)
  PUT             /api/v1/export/admin/users/{pk}/permissions/   — Grant export permissions (director)
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
from apps.core.roles import DIRECTOR_ONLY, PRIVILEGED_ROLES as _PRIVILEGED_ROLES
from apps.export.models import AuditLog, Notification

logger = logging.getLogger(__name__)

_DIRECTOR_ONLY = DIRECTOR_ONLY
_DIRECTOR_MANAGER = _PRIVILEGED_ROLES


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
    """Only role and is_active may be patched by director."""

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

    Accessible only to director and export_manager roles.

    GET /api/v1/export/audit-log/          — list (filter ?model_name=&action=&object_id=)
    GET /api/v1/export/audit-log/{id}/     — detail
    """

    permission_classes = [IsAuthenticated]
    serializer_class = AuditLogSerializer

    queryset = AuditLog.objects.select_related('user').order_by('-created_at')

    def check_permissions(self, request):
        super().check_permissions(request)
        _require_role(request.user, _DIRECTOR_MANAGER, 'view audit logs')

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
    Only director may create, update, or delete.

    GET    /api/v1/export/admin/seasons/       — list
    GET    /api/v1/export/admin/seasons/{id}/  — detail
    POST   /api/v1/export/admin/seasons/       — create (director only)
    PATCH  /api/v1/export/admin/seasons/{id}/  — update (director only)
    DELETE /api/v1/export/admin/seasons/{id}/  — delete (director only)
    """

    resource_code = 'season'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = SeasonSerializer
    queryset = Season.objects.all().order_by('-start_date')


class ExportFirmViewSet(ModelViewSet):
    """ExportFirm CRUD.

    All authenticated users may list/retrieve.
    Director (or superuser, or user with Django permission) may create, update, or delete.

    GET    /api/v1/export/admin/firms/       — list
    GET    /api/v1/export/admin/firms/{id}/  — detail
    POST   /api/v1/export/admin/firms/       — create (director / add_exportfirm perm)
    PATCH  /api/v1/export/admin/firms/{id}/  — update (director / change_exportfirm perm)
    DELETE /api/v1/export/admin/firms/{id}/  — delete (director / delete_exportfirm perm)
    """

    resource_code = 'export_firm'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ExportFirmSerializer
    queryset = ExportFirm.objects.all().order_by('name_en')


class ImportFirmViewSet(ModelViewSet):
    """ImportFirm CRUD.

    All authenticated users may list/retrieve.
    Director (or superuser, or user with Django permission) may create, update, or delete.

    GET    /api/v1/export/admin/import-firms/       — list
    GET    /api/v1/export/admin/import-firms/{id}/  — detail
    POST   /api/v1/export/admin/import-firms/       — create (director / add_importfirm perm)
    PATCH  /api/v1/export/admin/import-firms/{id}/  — update (director / change_importfirm perm)
    DELETE /api/v1/export/admin/import-firms/{id}/  — delete (director / delete_importfirm perm)
    """

    resource_code = 'import_firm'
    parser_classes = [MultiPartParser, JSONParser]
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = ImportFirmSerializer
    queryset = ImportFirm.objects.select_related('country', 'city').order_by('name_company')


class UserManagementViewSet(ModelViewSet):
    """User management for directors and superusers.

    List and retrieve: director or export_manager (or superuser).
    PATCH role/is_active: director only (or superuser).
    POST create user: superuser only.
    DELETE user: superuser only (self-deletion blocked).
    POST set-password: superuser only.

    GET    /api/v1/export/admin/users/                       — list all users
    GET    /api/v1/export/admin/users/{id}/                  — detail
    PATCH  /api/v1/export/admin/users/{id}/                  — update role + is_active (director/superuser)
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
            _require_role(user, _DIRECTOR_MANAGER, 'view user list')
        return User.objects.prefetch_related('user_permissions').order_by('username')

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            return UserPatchSerializer
        return UserListSerializer

    def partial_update(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            _require_role(request.user, _DIRECTOR_ONLY, 'update user roles')
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

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
        _require_role(request.user, _DIRECTOR_ONLY, 'manage user permissions')

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
