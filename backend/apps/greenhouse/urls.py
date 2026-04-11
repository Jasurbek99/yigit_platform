from rest_framework.routers import DefaultRouter

from apps.greenhouse.views import DomesticSaleViewSet, WeeklyHarvestPlanViewSet
from apps.greenhouse.views_admin import BlockManagerAssignmentViewSet, GreenhouseBlockAdminViewSet

router = DefaultRouter()

router.register('harvest-plans', WeeklyHarvestPlanViewSet, basename='harvest-plan')
router.register('domestic-sales', DomesticSaleViewSet, basename='domestic-sale')
router.register('admin/blocks', GreenhouseBlockAdminViewSet, basename='admin-block')
router.register('admin/block-assignments', BlockManagerAssignmentViewSet, basename='admin-block-assignment')

urlpatterns = router.urls
