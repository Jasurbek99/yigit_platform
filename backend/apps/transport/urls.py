from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.transport.views import (
    LivePositionViewSet,
    ShipmentTruckPositionView,
    ShipmentDeviceLinkView,
    TransportDeviceViewSet,
)

router = DefaultRouter()
router.register('live-positions', LivePositionViewSet, basename='live-positions')
router.register('devices', TransportDeviceViewSet, basename='transport-devices')

urlpatterns = [
    path('shipments/<int:shipment_id>/position/', ShipmentTruckPositionView.as_view()),
    path('shipments/<int:shipment_id>/device/', ShipmentDeviceLinkView.as_view()),
    *router.urls,
]
