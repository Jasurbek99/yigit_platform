"""URL routing for the contracts app."""
from rest_framework.routers import DefaultRouter

from apps.contracts.views import ContractViewSet, InvoiceViewSet

router = DefaultRouter()
router.register(r'contracts', ContractViewSet, basename='contract')
router.register(r'invoices', InvoiceViewSet, basename='invoice')

urlpatterns = router.urls
