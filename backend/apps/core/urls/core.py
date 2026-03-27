from rest_framework.routers import DefaultRouter
from apps.core.views import CountryViewSet, ExportFirmViewSet, ShipmentStatusTypeViewSet

router = DefaultRouter()
router.register('countries', CountryViewSet, basename='country')
router.register('export-firms', ExportFirmViewSet, basename='export-firm')
router.register('status-types', ShipmentStatusTypeViewSet, basename='status-type')

urlpatterns = router.urls
