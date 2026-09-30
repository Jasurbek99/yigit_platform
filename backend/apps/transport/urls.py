from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.transport.views import (
    CurrentGeofencesView,
    DriverViewSet,
    LivePositionViewSet,
    ShipmentTruckPositionView,
    ShipmentDeviceLinkView,
    TrailerViewSet,
    TransportDeviceViewSet,
    TruckHeadViewSet,
)
from apps.transport.views_trips import ExternalTripViewSet, ShipmentTripView

router = DefaultRouter()
router.register('live-positions', LivePositionViewSet, basename='live-positions')
router.register('devices', TransportDeviceViewSet, basename='transport-devices')
router.register('truck-heads', TruckHeadViewSet, basename='truck-heads')
router.register('trailers', TrailerViewSet, basename='trailers')
router.register('drivers', DriverViewSet, basename='drivers')
router.register('external-trips', ExternalTripViewSet, basename='external-trips')

urlpatterns = [
    path('geofences/current/', CurrentGeofencesView.as_view()),
    path('shipments/<int:shipment_id>/position/', ShipmentTruckPositionView.as_view()),
    path('shipments/<int:shipment_id>/device/', ShipmentDeviceLinkView.as_view()),
    path('shipments/<int:shipment_id>/trip/', ShipmentTripView.as_view()),
    *router.urls,
]
