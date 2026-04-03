from rest_framework.routers import DefaultRouter
from apps.core.views import (
    CountryViewSet,
    ExportFirmViewSet,
    ShipmentStatusTypeViewSet,
    CustomerViewSet,
    GreenhouseBlockViewSet,
)

router = DefaultRouter()
router.register('countries', CountryViewSet, basename='country')
router.register('export-firms', ExportFirmViewSet, basename='export-firm')
router.register('status-types', ShipmentStatusTypeViewSet, basename='status-type')
router.register('customers', CustomerViewSet, basename='customer')
router.register('blocks', GreenhouseBlockViewSet, basename='block')

urlpatterns = router.urls
