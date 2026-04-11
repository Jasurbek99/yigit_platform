"""Extended auth views that add export-specific data to the user response.

Overrides core's /auth/me/ and /auth/login/ to include managed_block_ids
and dynamic permissions without violating the core ← export dependency direction.
"""
from rest_framework import serializers

from apps.core.serializers import UserMeSerializer
from apps.core.permissions import (
    get_page_permissions,
    get_resource_permissions,
    get_all_field_permissions,
)
from apps.core.views import LoginView as CoreLoginView, MeView as CoreMeView
from apps.greenhouse.models import BlockManagerAssignment


class ExtendedUserMeSerializer(UserMeSerializer):
    """Adds managed_block_ids and dynamic permissions to the base user response."""

    managed_block_ids = serializers.SerializerMethodField()
    page_permissions = serializers.SerializerMethodField()
    resource_permissions = serializers.SerializerMethodField()
    field_permissions = serializers.SerializerMethodField()

    class Meta(UserMeSerializer.Meta):
        fields = [
            *UserMeSerializer.Meta.fields,
            'managed_block_ids',
            'page_permissions',
            'resource_permissions',
            'field_permissions',
        ]
        read_only_fields = fields

    def get_managed_block_ids(self, obj) -> list[int]:
        """Return block IDs this user is assigned to manage.

        Only meaningful for greenhouse_manager role; returns [] for others.
        """
        if obj.role != 'greenhouse_manager':
            return []
        return list(
            BlockManagerAssignment.objects.filter(
                user=obj, is_active=True,
            ).values_list('block_id', flat=True)
        )

    def get_page_permissions(self, obj) -> dict[str, bool]:
        """Return {page_code: is_visible} for the user's role.

        Superusers get all pages visible.
        """
        if obj.is_superuser:
            from apps.core.permission_registry import PAGE_REGISTRY
            return {code: True for code in PAGE_REGISTRY}
        return get_page_permissions(obj.role)

    def get_resource_permissions(self, obj) -> dict[str, dict[str, bool]]:
        """Return {resource_code: {view, create, edit, delete}} for the user's role.

        Superusers get full CRUD on everything.
        """
        if obj.is_superuser:
            from apps.core.permission_registry import RESOURCE_REGISTRY
            return {
                code: {'view': True, 'create': True, 'edit': True, 'delete': True}
                for code in RESOURCE_REGISTRY
            }
        return get_resource_permissions(obj.role)

    def get_field_permissions(self, obj) -> dict[str, list[str]]:
        """Return {resource_code: [field_name, ...]} for the user's role.

        Superusers get wildcard on everything.
        """
        if obj.is_superuser:
            from apps.core.permission_registry import RESOURCE_REGISTRY
            return {code: ['*'] for code in RESOURCE_REGISTRY}
        return get_all_field_permissions(obj.role)


class MeView(CoreMeView):
    """GET /api/v1/auth/me/ — extended with managed_block_ids."""

    def get(self, request):
        from rest_framework.response import Response
        return Response(ExtendedUserMeSerializer(request.user).data)


class LoginView(CoreLoginView):
    """POST /api/v1/auth/login/ — uses extended serializer for response."""

    def post(self, request):
        from apps.core.models import User

        response = super().post(request)
        if response.status_code == 200:
            # request.user is still AnonymousUser (JWT cookie not yet processed),
            # so look up the authenticated user from the response data.
            user = User.objects.get(id=response.data['id'])
            response.data = ExtendedUserMeSerializer(user).data
        return response
