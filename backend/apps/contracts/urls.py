"""URL routing for the contracts app."""
from rest_framework.routers import DefaultRouter

from apps.contracts.views import ContractSaleViewSet, ContractViewSet

router = DefaultRouter()
router.register(r'contracts', ContractViewSet, basename='contract')
router.register(r'sales', ContractSaleViewSet, basename='sale')

urlpatterns = router.urls
