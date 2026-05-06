from django.urls import path

from apps.core.views_me import MeKpiTodayView, MeTaskListView

urlpatterns = [
    path('tasks/', MeTaskListView.as_view(), name='me-tasks'),
    path('kpi-today/', MeKpiTodayView.as_view(), name='me-kpi-today'),
]
