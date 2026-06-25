"""URL routing for the contracts app."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.contracts.views import (
    ContractSaleViewSet,
    ContractViewSet,
    ShipmentFirmContractsView,
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
    *router.urls,
]
