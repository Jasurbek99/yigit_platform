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

router = DefaultRouter()
router.register('shipments', ShipmentViewSet, basename='shipment')
router.register('advances', FinansistAdvanceViewSet, basename='advance')
router.register('harvest-plans', WeeklyHarvestPlanViewSet, basename='harvest-plan')
router.register('truck-allocations', WeeklyTruckAllocationViewSet, basename='truck-allocation')
router.register('quotas', QuotaAllocationViewSet, basename='quota')
router.register('prices', PriceEntryViewSet, basename='price')
router.register('domestic-sales', DomesticSaleViewSet, basename='domestic-sale')

urlpatterns = router.urls
