from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.export.views import ShipmentViewSet
from apps.export.views_finance import FinansistAdvanceViewSet
from apps.export.views_planning import (
    WeeklyHarvestPlanViewSet,
    WeeklyTruckAllocationViewSet,
    QuotaAllocationViewSet,
    PriceEntryViewSet,
    DomesticSaleViewSet,
)
from apps.export.views_admin import (
    NotificationViewSet,
    AuditLogViewSet,
    SeasonViewSet,
    ExportFirmViewSet,
    ImportFirmViewSet,
    UserManagementViewSet,
    BlockManagerAssignmentViewSet,
    GreenhouseBlockAdminViewSet,
    UserPermissionsView,
)

router = DefaultRouter()

# Core export resources
router.register('shipments', ShipmentViewSet, basename='shipment')
router.register('advances', FinansistAdvanceViewSet, basename='advance')

# Planning & pricing
router.register('harvest-plans', WeeklyHarvestPlanViewSet, basename='harvest-plan')
router.register('truck-allocations', WeeklyTruckAllocationViewSet, basename='truck-allocation')
router.register('quotas', QuotaAllocationViewSet, basename='quota')
router.register('prices', PriceEntryViewSet, basename='price')
router.register('domestic-sales', DomesticSaleViewSet, basename='domestic-sale')

# Notifications & audit
router.register('notifications', NotificationViewSet, basename='notification')
router.register('audit-log', AuditLogViewSet, basename='audit-log')

# Admin / settings
router.register('admin/seasons', SeasonViewSet, basename='admin-season')
router.register('admin/firms', ExportFirmViewSet, basename='admin-firm')
router.register('admin/import-firms', ImportFirmViewSet, basename='admin-import-firm')
router.register('admin/users', UserManagementViewSet, basename='admin-user')
router.register('admin/block-assignments', BlockManagerAssignmentViewSet, basename='admin-block-assignment')
router.register('admin/blocks', GreenhouseBlockAdminViewSet, basename='admin-block')

urlpatterns = router.urls + [
    path(
        'admin/users/<int:pk>/permissions/',
        UserPermissionsView.as_view(),
        name='admin-user-permissions',
    ),
]
