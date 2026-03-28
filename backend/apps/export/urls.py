from rest_framework.routers import DefaultRouter
from apps.export.views import ShipmentViewSet
from apps.export.views_finance import FinansistAdvanceViewSet
from apps.export.views_planning import (
    WeeklyHarvestPlanViewSet,
    QuotaAllocationViewSet,
    PriceEntryViewSet,
)

router = DefaultRouter()
router.register('shipments', ShipmentViewSet, basename='shipment')
router.register('advances', FinansistAdvanceViewSet, basename='advance')
router.register('harvest-plans', WeeklyHarvestPlanViewSet, basename='harvest-plan')
router.register('quotas', QuotaAllocationViewSet, basename='quota')
router.register('prices', PriceEntryViewSet, basename='price')

urlpatterns = router.urls
