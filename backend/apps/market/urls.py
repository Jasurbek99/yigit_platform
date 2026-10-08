from rest_framework.routers import DefaultRouter

from apps.market.views import AgentLoginViewSet

router = DefaultRouter()
router.register('agents', AgentLoginViewSet, basename='market-agents')

urlpatterns = [
    *router.urls,
]
