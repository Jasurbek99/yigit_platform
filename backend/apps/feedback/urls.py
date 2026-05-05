from rest_framework.routers import DefaultRouter

from apps.feedback.views import FeedbackTicketViewSet

router = DefaultRouter()
router.register(r'tickets', FeedbackTicketViewSet, basename='feedback-ticket')

urlpatterns = router.urls
