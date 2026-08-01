from rest_framework.routers import DefaultRouter

from apps.transport.views import LivePositionViewSet

router = DefaultRouter()
router.register('live-positions', LivePositionViewSet, basename='live-positions')

urlpatterns = router.urls
