from rest_framework.routers import DefaultRouter
from apps.core.views import (
    CityViewSet,
    CountryViewSet,
    ExportFirmViewSet,
    ShipmentStatusTypeViewSet,
    CustomerViewSet,
    GreenhouseBlockViewSet,
    LoadingLocationViewSet,
    TomatoVarietyViewSet,
    TruckDestinationViewSet,
)

router = DefaultRouter()
router.register('countries', CountryViewSet, basename='country')
router.register('cities', CityViewSet, basename='city')
router.register('export-firms', ExportFirmViewSet, basename='export-firm')
router.register('status-types', ShipmentStatusTypeViewSet, basename='status-type')
router.register('customers', CustomerViewSet, basename='customer')
router.register('blocks', GreenhouseBlockViewSet, basename='block')
router.register('loading-locations', LoadingLocationViewSet, basename='loading-location')
router.register('tomato-varieties', TomatoVarietyViewSet, basename='tomato-variety')
router.register('truck-destinations', TruckDestinationViewSet, basename='truck-destination')

urlpatterns = router.urls
