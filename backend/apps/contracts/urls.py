"""URL routing for the contracts app."""
from rest_framework.routers import DefaultRouter

from apps.contracts.views import ContractViewSet

router = DefaultRouter()
router.register(r'contracts', ContractViewSet, basename='contract')

urlpatterns = router.urls
