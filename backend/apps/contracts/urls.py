"""URL routing for the contracts app."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.contracts.views import (
    ContractSaleViewSet,
    ContractViewSet,
    ShipmentCmrView,
    ShipmentFirmContractsView,
    ShipmentPackingView,
)

router = DefaultRouter()
router.register(r'contracts', ContractViewSet, basename='contract')
router.register(r'sales', ContractSaleViewSet, basename='sale')

urlpatterns = [
    path(
        'shipment-firm-contracts/',
        ShipmentFirmContractsView.as_view(),
        name='shipment-firm-contracts',
    ),
    path(
        'shipment-packing/',
        ShipmentPackingView.as_view(),
        name='shipment-packing',
    ),
    path(
        'shipments/<int:pk>/cmr/',
        ShipmentCmrView.as_view(),
        name='shipment-cmr',
    ),
    *router.urls,
]
