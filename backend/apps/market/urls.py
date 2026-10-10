from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.market.views import (
    AgentLoginViewSet,
    AvailableShipmentsView,
    BazaarViewSet,
    BuyerListView,
    DebtsView,
    ExpenseCategoryListView,
    LotViewSet,
    MarketMeView,
    MarkSalePaidView,
    PaymentCreateView,
    PaymentDetailView,
    SellerViewSet,
)

router = DefaultRouter()
router.register('agents', AgentLoginViewSet, basename='market-agents')
router.register('team/bazaars', BazaarViewSet, basename='market-bazaars')
router.register('team/sellers', SellerViewSet, basename='market-sellers')
router.register('lots', LotViewSet, basename='market-lots')

urlpatterns = [
    path('me/', MarketMeView.as_view(), name='market-me'),
    path('shipments/', AvailableShipmentsView.as_view(), name='market-shipments'),
    path('expense-categories/', ExpenseCategoryListView.as_view(), name='market-expense-categories'),
    path('buyers/', BuyerListView.as_view(), name='market-buyers'),
    path('debts/', DebtsView.as_view(), name='market-debts'),
    path('payments/', PaymentCreateView.as_view(), name='market-payments'),
    path('payments/<int:pk>/', PaymentDetailView.as_view(), name='market-payment-detail'),
    path('sales/<int:pk>/mark-paid/', MarkSalePaidView.as_view(), name='market-sale-mark-paid'),
    *router.urls,
]
