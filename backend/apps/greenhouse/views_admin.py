"""Admin-facing viewsets for greenhouse block and block-manager assignment management.

Endpoints:
  GET/POST/PATCH/DELETE /api/v1/greenhouse/admin/blocks/              — GreenhouseBlock CRUD (director writes)
  GET/POST/DELETE       /api/v1/greenhouse/admin/block-assignments/   — BlockManagerAssignment CRUD (director)
"""

from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.core.models import GreenhouseBlock
from apps.core.permissions import write_permission
from apps.core.roles import REFERENCE_DATA_WRITE
from apps.greenhouse.models import BlockManagerAssignment
from apps.greenhouse.serializers import BlockManagerAssignmentSerializer


# ---------------------------------------------------------------------------
# Greenhouse block admin
# ---------------------------------------------------------------------------

class GreenhouseBlockSubSerializer(serializers.ModelSerializer):
    """Lightweight serializer for nested sub-blocks (no further nesting)."""

    variety_main_name = serializers.SerializerMethodField()
    variety_secondary_name = serializers.SerializerMethodField()

    class Meta:
        model = GreenhouseBlock
        fields = [
            'id', 'code', 'name',
            'variety_main', 'variety_main_name',
            'variety_secondary', 'variety_secondary_name',
            'area_m2', 'section_count', 'sowing_date',
            'color', 'sort_order',
            'is_active',
        ]

    def get_variety_main_name(self, obj: GreenhouseBlock) -> str | None:
        return obj.variety_main.name if obj.variety_main_id else None

    def get_variety_secondary_name(self, obj: GreenhouseBlock) -> str | None:
        return obj.variety_secondary.name if obj.variety_secondary_id else None


class GreenhouseBlockAdminSerializer(serializers.ModelSerializer):
    """Full serializer for director-level greenhouse block management."""

    manager_name = serializers.SerializerMethodField()
    variety_main_name = serializers.SerializerMethodField()
    variety_secondary_name = serializers.SerializerMethodField()
    location_name = serializers.SerializerMethodField()
    parent_code = serializers.SerializerMethodField()
    sub_blocks = serializers.SerializerMethodField()

    class Meta:
        model = GreenhouseBlock
        fields = [
            'id', 'code', 'name',
            'parent', 'parent_code',
            'manager', 'manager_name',
            'variety_main', 'variety_main_name',
            'variety_secondary', 'variety_secondary_name',
            'area_m2',
            'location', 'location_name',
            'section_count', 'sowing_date',
            'season_start_month',
            'color', 'sort_order',
            'is_active',
            'sub_blocks',
        ]

    def get_manager_name(self, obj: GreenhouseBlock) -> str | None:
        if obj.manager_id is None:
            return None
        return obj.manager.get_full_name() or obj.manager.username

    def get_variety_main_name(self, obj: GreenhouseBlock) -> str | None:
        return obj.variety_main.name if obj.variety_main_id else None

    def get_variety_secondary_name(self, obj: GreenhouseBlock) -> str | None:
        return obj.variety_secondary.name if obj.variety_secondary_id else None

    def get_location_name(self, obj: GreenhouseBlock) -> str | None:
        return obj.location.name if obj.location_id else None

    def get_parent_code(self, obj: GreenhouseBlock) -> str | None:
        return obj.parent.code if obj.parent_id else None

    def get_sub_blocks(self, obj: GreenhouseBlock) -> list:
        """Return nested sub-blocks only on detail (retrieve) view, not list."""
        request = self.context.get('request')
        if request and request.parser_context.get('kwargs', {}).get('pk'):
            qs = obj.sub_blocks.select_related('variety_main', 'variety_secondary').order_by('code')
            return GreenhouseBlockSubSerializer(qs, many=True, context=self.context).data
        return []


class GreenhouseBlockAdminViewSet(ModelViewSet):
    """Director-only CRUD for greenhouse blocks.

    All authenticated users may list/retrieve (used by harvest plan, etc).
    Only director may create, update, or delete.

    GET    /api/v1/greenhouse/admin/blocks/           — list parent blocks only
    GET    /api/v1/greenhouse/admin/blocks/{id}/      — detail with nested sub_blocks
    POST   /api/v1/greenhouse/admin/blocks/           — create (director only)
    PATCH  /api/v1/greenhouse/admin/blocks/{id}/      — update (director only)
    DELETE /api/v1/greenhouse/admin/blocks/{id}/      — delete (director only)
    """

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = GreenhouseBlockAdminSerializer

    def get_queryset(self):
        qs = GreenhouseBlock.objects.select_related(
            'parent', 'manager', 'variety_main', 'variety_secondary', 'location'
        ).order_by('code')
        if self.action == 'list':
            qs = qs.filter(parent__isnull=True)
        return qs


# ---------------------------------------------------------------------------
# Block-manager assignment admin
# ---------------------------------------------------------------------------

class BlockManagerAssignmentViewSet(ModelViewSet):
    """Director-only CRUD for block-manager assignments.

    GET    /api/v1/greenhouse/admin/block-assignments/          — list (filter by ?user=<id>)
    POST   /api/v1/greenhouse/admin/block-assignments/          — create
    DELETE /api/v1/greenhouse/admin/block-assignments/{id}/     — delete
    GET    /api/v1/greenhouse/admin/block-assignments/{id}/     — detail
    """

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = BlockManagerAssignmentSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    queryset = BlockManagerAssignment.objects.select_related('user', 'block').order_by(
        'user', 'block__code'
    )

    def get_queryset(self):
        qs = super().get_queryset()
        if user_id := self.request.query_params.get('user'):
            try:
                qs = qs.filter(user_id=int(user_id))
            except (ValueError, TypeError):
                pass
        return qs
