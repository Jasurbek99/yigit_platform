---
name: api-endpoint
description: "Create DRF API endpoints with serializers, viewsets, and URL routing following api-contract.md. Use when building API endpoints."
---

# API Endpoint Skill (DRF + api-contract.md)

## Serializer with DB→API field renaming

```python
# apps/export/serializers.py
from rest_framework import serializers
from apps.export.models import Shipment


class ShipmentListSerializer(serializers.ModelSerializer):
    """List view — lightweight, no nested objects."""
    # DB→API field renaming per api-contract.md
    cargo_code = serializers.CharField(source='code', read_only=True)
    weight_net = serializers.DecimalField(source='weight_net_kg', max_digits=10, decimal_places=2, read_only=True)
    weight_gross = serializers.DecimalField(source='weight_gross_kg', max_digits=10, decimal_places=2, read_only=True)
    
    # FK display names (frontend never needs a second API call)
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    country_name = serializers.CharField(source='country.name_en', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)

    class Meta:
        model = Shipment
        fields = [
            'id', 'cargo_code', 'date', 'status', 'status_display',
            'country_name', 'customer_name',
            'weight_net', 'weight_gross',
            'departed_at', 'arrived_at', 'is_gapy_satys',
        ]


class ShipmentDetailSerializer(ShipmentListSerializer):
    """Detail view — includes nested related data."""
    firm_splits = serializers.SerializerMethodField()
    block_sources = serializers.SerializerMethodField()
    status_log = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    quality = serializers.SerializerMethodField()
    editable_fields = serializers.SerializerMethodField()

    class Meta(ShipmentListSerializer.Meta):
        fields = ShipmentListSerializer.Meta.fields + [
            'import_firm', 'border_point', 'loading_location',
            'packaging_kg', 'pallet_count', 'box_count',
            'vehicle_condition', 'vehicle_condition_note', 'route_note',
            'loading_started_at', 'customs_entry_at', 'customs_exit_at',
            'departed_at', 'border_crossed_at', 'arrived_at',
            'sale_started_at', 'sale_ended_at',
            'price_per_kg', 'total_amount_usd',
            'has_peregruz', 'peregruz_city',
            'firm_splits', 'block_sources', 'status_log', 'comments', 'quality',
            'editable_fields', 'notes',
        ]

    def get_firm_splits(self, obj):
        return obj.shipment_firm_splits.values(
            'export_firm_id', export_firm_name=F('export_firm__name_en'),
            'weight_kg', 'amount_usd'
        )

    def get_editable_fields(self, obj):
        """Return list of field names this user can edit, based on role."""
        user = self.context['request'].user
        from apps.export.constants import ROLE_EDITABLE_FIELDS
        return ROLE_EDITABLE_FIELDS.get(user.role, [])
```

## ViewSet with list/detail split

```python
# apps/export/views.py
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters


class ShipmentViewSet(viewsets.ModelViewSet):
    queryset = Shipment.objects.select_related(
        'status', 'country', 'customer', 'import_firm',
    ).all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'country', 'customer', 'is_gapy_satys']
    search_fields = ['code', 'vehicle_responsible']
    ordering_fields = ['date', 'weight_net_kg', 'departed_at', 'arrived_at']
    ordering = ['-date']

    def get_serializer_class(self):
        if self.action == 'list':
            return ShipmentListSerializer
        return ShipmentDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('my_work') == 'true':
            from apps.export.constants import ROLE_ACTIVE_WINDOW
            window = ROLE_ACTIVE_WINDOW.get(self.request.user.role)
            if window:
                qs = qs.filter(
                    status__step_order__gte=window[0],
                    status__step_order__lte=window[1],
                ).exclude(status__code='tamamlandy')
        return qs

    @action(detail=True, methods=['post'], url_path='transition')
    def transition(self, request, pk=None):
        shipment = self.get_object()
        new_status = request.data.get('new_status')
        comment = request.data.get('comment', '')
        try:
            shipment.transition_to(new_status, request.user, notes=comment)
            return Response(ShipmentDetailSerializer(shipment, context={'request': request}).data)
        except (ValueError, PermissionError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
```

## URL registration

```python
# apps/export/urls.py
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'shipments', ShipmentViewSet, basename='shipment')

urlpatterns = router.urls

# config/urls.py
urlpatterns = [
    path('api/v1/export/', include('apps.export.urls')),
    path('api/v1/core/', include('apps.core.urls')),
    path('api/v1/auth/', include('apps.core.auth_urls')),
]
```

## Key patterns
- List serializer: flat, display names, no nested objects
- Detail serializer: includes nested related data + `editable_fields[]`
- `source='db_column_name'` on serializer fields to rename DB→API
- `get_queryset()` handles `?my_work=true` filter
- Transition endpoint: POST with status code + comment, returns updated detail
