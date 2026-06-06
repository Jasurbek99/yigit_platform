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
    CrateTypeViewSet,
    TruckDestinationViewSet,
    BorderPointViewSet,
    ShipmentOptionTypeViewSet,
    MentionableView,
    GreenhouseConfigView,
    OperatingDayExceptionViewSet,
)
from apps.core.views_permissions import (
    PagePermissionMatrixView,
    ResourcePermissionMatrixView,
    FieldPermissionMatrixView,
    PermissionRegistryView,
)
from apps.core.views_worklog import (
    WorklogListView,
    WorklogMeView,
    WorklogTeamView,
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
router.register('crate-types', CrateTypeViewSet, basename='crate-type')
router.register('truck-destinations', TruckDestinationViewSet, basename='truck-destination')
router.register('border-points', BorderPointViewSet, basename='border-point')
router.register('shipment-options', ShipmentOptionTypeViewSet, basename='shipment-option')
router.register('operating-day-exceptions', OperatingDayExceptionViewSet, basename='operating-day-exception')

urlpatterns = router.urls + [
    path('admin/permission-registry/', PermissionRegistryView.as_view(), name='permission-registry'),
    path('admin/page-permissions/', PagePermissionMatrixView.as_view(), name='page-permissions'),
    path('admin/resource-permissions/', ResourcePermissionMatrixView.as_view(), name='resource-permissions'),
    path('admin/field-permissions/', FieldPermissionMatrixView.as_view(), name='field-permissions'),
    path('users/mentionable/', MentionableView.as_view(), name='users-mentionable'),
    path('greenhouse-config/', GreenhouseConfigView.as_view(), name='greenhouse-config'),
    # Worklog (Phase 3 of WS feature). All authenticated users may read.
    path('worklog/', WorklogListView.as_view(), name='worklog-list'),
    path('worklog/me/', WorklogMeView.as_view(), name='worklog-me'),
    path('worklog/team/', WorklogTeamView.as_view(), name='worklog-team'),
]
