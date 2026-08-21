"""URL routing for the contracts app."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.contracts.views import (
    ContractSaleViewSet,
    ContractViewSet,
    DocumentLayoutDetailView,
    DocumentLayoutListView,
    DocumentPacketListView,
    ShipmentCmrView,
    ShipmentFirmContractsView,
    ShipmentPacketZipView,
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
    path(
        'shipments/<int:pk>/packet.zip',
        ShipmentPacketZipView.as_view(),
        name='shipment-packet-zip',
    ),
    path(
        'document-layouts/',
        DocumentLayoutListView.as_view(),
        name='document-layouts',
    ),
    path(
        'document-layouts/<str:document_key>/',
        DocumentLayoutDetailView.as_view(),
        name='document-layout-detail',
    ),
    path(
        'document-packets/',
        DocumentPacketListView.as_view(),
        name='document-packets',
    ),
    *router.urls,
]
