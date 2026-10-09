from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.market.views import AgentLoginViewSet, BazaarViewSet, MarketMeView, SellerViewSet

router = DefaultRouter()
router.register('agents', AgentLoginViewSet, basename='market-agents')
router.register('team/bazaars', BazaarViewSet, basename='market-bazaars')
router.register('team/sellers', SellerViewSet, basename='market-sellers')

urlpatterns = [
    path('me/', MarketMeView.as_view(), name='market-me'),
    *router.urls,
]
