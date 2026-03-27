from rest_framework.routers import DefaultRouter
from apps.export.views import ShipmentViewSet

router = DefaultRouter()
router.register('shipments', ShipmentViewSet, basename='shipment')

urlpatterns = router.urls
