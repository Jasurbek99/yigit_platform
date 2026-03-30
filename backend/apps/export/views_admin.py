"""Admin-facing viewsets for notifications, audit log, and settings CRUD.

Endpoints:
  GET/PATCH /api/v1/export/notifications/              — own notifications
  POST      /api/v1/export/notifications/read_all/     — mark all read
  POST      /api/v1/export/notifications/{id}/read/    — mark one read

  GET       /api/v1/export/audit-log/                  — transition history (director/export_manager)

  GET/POST/PATCH/DELETE /api/v1/export/admin/seasons/  — Season CRUD (director writes)
  GET/POST/PATCH/DELETE /api/v1/export/admin/firms/    — ExportFirm CRUD (director writes)
  GET/PATCH             /api/v1/export/admin/users/    — User list + role/is_active patch (director)
"""
import logging

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.core.models import ExportFirm, Season, User
from apps.core.permissions import write_permission
from apps.export.models import AuditLog, Notification

logger = logging.getLogger(__name__)

_DIRECTOR_ONLY = frozenset({'director'})
_DIRECTOR_MANAGER = frozenset({'director', 'export_manager'})


def _require_role(user, allowed: frozenset, verb: str = 'perform this action') -> None:
    """Raise PermissionDenied unless user.role is in allowed."""
    if getattr(user, 'role', None) not in allowed:
        raise PermissionDenied(f"Role '{user.role}' is not allowed to {verb}.")


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
        # Include the standard name fields; quota_allocated_kg is a balance field.
        fields = [
            'id', 'name', 'name_en', 'name_ru', 'name_tk',
            'quota_allocated_kg', 'is_active',
        ]

    def to_representation(self, instance):
        # Gracefully handle optional/missing fields on ExportFirm variants.
        rep = {}
        for field_name, field in self.fields.items():
            try:
                value = field.to_representation(field.get_attribute(instance))
            except Exception:
                value = None
            rep[field_name] = value
        return rep


class UserListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'is_active', 'phone']
        read_only_fields = ['id', 'username', 'first_name', 'last_name', 'email', 'phone']


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

    def get_queryset(self):
        _require_role(self.request.user, _DIRECTOR_MANAGER, 'view audit logs')
        qs = super().get_queryset()
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

    permission_classes = [IsAuthenticated, write_permission(*_DIRECTOR_ONLY)]
    serializer_class = SeasonSerializer
    queryset = Season.objects.all().order_by('-start_date')


class ExportFirmViewSet(ModelViewSet):
    """ExportFirm CRUD.

    All authenticated users may list/retrieve.
    Only director may create, update, or delete.

    GET    /api/v1/export/admin/firms/       — list
    GET    /api/v1/export/admin/firms/{id}/  — detail
    POST   /api/v1/export/admin/firms/       — create (director only)
    PATCH  /api/v1/export/admin/firms/{id}/  — update (director only)
    DELETE /api/v1/export/admin/firms/{id}/  — delete (director only)
    """

    permission_classes = [IsAuthenticated, write_permission(*_DIRECTOR_ONLY)]
    serializer_class = ExportFirmSerializer
    queryset = ExportFirm.objects.all().order_by('name_en')


class UserManagementViewSet(ModelViewSet):
    """User management for directors.

    List and retrieve are open to all authenticated users.
    Only director may PATCH role and is_active fields.
    No POST/DELETE — users are created through Django admin or auth flow.

    GET   /api/v1/export/admin/users/       — list all users
    GET   /api/v1/export/admin/users/{id}/  — detail
    PATCH /api/v1/export/admin/users/{id}/  — update role + is_active (director only)
    """

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'head', 'options']  # no POST/DELETE/PUT

    queryset = User.objects.all().order_by('username')

    def get_serializer_class(self):
        if self.request.method == 'PATCH':
            return UserPatchSerializer
        return UserListSerializer

    def partial_update(self, request, *args, **kwargs):
        _require_role(request.user, _DIRECTOR_ONLY, 'update user roles')
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)
