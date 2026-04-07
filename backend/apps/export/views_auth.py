"""Extended auth views that add export-specific data to the user response.

Overrides core's /auth/me/ and /auth/login/ to include managed_block_ids
without violating the core ← export dependency direction.
"""
from rest_framework import serializers

from apps.core.serializers import UserMeSerializer
from apps.core.views import LoginView as CoreLoginView, MeView as CoreMeView
from apps.export.models import BlockManagerAssignment


class ExtendedUserMeSerializer(UserMeSerializer):
    """Adds managed_block_ids to the base user response."""

    managed_block_ids = serializers.SerializerMethodField()

    class Meta(UserMeSerializer.Meta):
        fields = [*UserMeSerializer.Meta.fields, 'managed_block_ids']
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


class MeView(CoreMeView):
    """GET /api/v1/auth/me/ — extended with managed_block_ids."""

    def get(self, request):
        from rest_framework.response import Response
        return Response(ExtendedUserMeSerializer(request.user).data)


class LoginView(CoreLoginView):
    """POST /api/v1/auth/login/ — uses extended serializer for response."""

    def post(self, request):
        response = super().post(request)
        if response.status_code == 200:
            response.data = ExtendedUserMeSerializer(request.user).data
        return response
