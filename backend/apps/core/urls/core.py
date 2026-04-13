from django.urls import path
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
    BorderPointViewSet,
    ShipmentOptionTypeViewSet,
)
from apps.core.views_permissions import (
    PagePermissionMatrixView,
    ResourcePermissionMatrixView,
    FieldPermissionMatrixView,
    PermissionRegistryView,
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
router.register('border-points', BorderPointViewSet, basename='border-point')
router.register('shipment-options', ShipmentOptionTypeViewSet, basename='shipment-option')

urlpatterns = router.urls + [
    path('admin/permission-registry/', PermissionRegistryView.as_view(), name='permission-registry'),
    path('admin/page-permissions/', PagePermissionMatrixView.as_view(), name='page-permissions'),
    path('admin/resource-permissions/', ResourcePermissionMatrixView.as_view(), name='resource-permissions'),
    path('admin/field-permissions/', FieldPermissionMatrixView.as_view(), name='field-permissions'),
]
