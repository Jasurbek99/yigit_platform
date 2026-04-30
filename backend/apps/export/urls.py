from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.export.views import ShipmentViewSet, CommentViewSet
from apps.export.views_analytics import BossAnalyticsViewSet
from apps.export.views_finance import FinansistAdvanceViewSet
from apps.export.views_planning import (
    WeeklyLocalSellPlanViewSet,
    WeeklyTruckAllocationViewSet,
    PriceEntryViewSet,
)
from apps.export.views_admin import (
    NotificationViewSet,
    AuditLogViewSet,
    SeasonViewSet,
    ExportFirmViewSet,
    ImportFirmViewSet,
    TruckSplitDefaultViewSet,
    UserManagementViewSet,
    UserPermissionsView,
)
from apps.export.views_quota import QuotaIssuanceViewSet, QuotaUsageViewSet, QuotaDashboardView
from apps.export.views_sheet_settings import SheetRowSettingViewSet
from apps.export.views_user_preferences import UserSheetPreferencesView

router = DefaultRouter()

# Boss Dashboard analytics
router.register('boss', BossAnalyticsViewSet, basename='boss-analytics')

# Core export resources
router.register('shipments', ShipmentViewSet, basename='shipment')
router.register('comments', CommentViewSet, basename='comment')
router.register('advances', FinansistAdvanceViewSet, basename='advance')

# Planning & pricing
router.register('truck-allocations', WeeklyTruckAllocationViewSet, basename='truck-allocation')
router.register('prices', PriceEntryViewSet, basename='price')
router.register('local-sell-plans', WeeklyLocalSellPlanViewSet, basename='local-sell-plan')

# Quota (new issuance-based system)
router.register('quota-issuances', QuotaIssuanceViewSet, basename='quota-issuance')
router.register('quota-usage', QuotaUsageViewSet, basename='quota-usage')

# Notifications & audit
router.register('notifications', NotificationViewSet, basename='notification')
router.register('audit-log', AuditLogViewSet, basename='audit-log')

# Admin / settings
router.register('admin/seasons', SeasonViewSet, basename='admin-season')
router.register('admin/firms', ExportFirmViewSet, basename='admin-firm')
router.register('admin/import-firms', ImportFirmViewSet, basename='admin-import-firm')
router.register('admin/users', UserManagementViewSet, basename='admin-user')
router.register('admin/truck-splits', TruckSplitDefaultViewSet, basename='admin-truck-split')
router.register('admin/sheet-rows', SheetRowSettingViewSet, basename='admin-sheet-row')

urlpatterns = router.urls + [
    path(
        'admin/users/<int:pk>/permissions/',
        UserPermissionsView.as_view(),
        name='admin-user-permissions',
    ),
    path('quota-dashboard/', QuotaDashboardView.as_view(), name='quota-dashboard'),
    path(
        'user/sheet-preferences/',
        UserSheetPreferencesView.as_view(),
        name='user-sheet-preferences',
    ),
]
