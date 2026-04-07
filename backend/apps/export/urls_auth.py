"""Auth URL overrides from the export app.

These shadow core's /auth/me/ and /auth/login/ to include export-specific
data (managed_block_ids) without a core → export circular import.
"""
from django.urls import path

from apps.export.views_auth import LoginView, MeView

urlpatterns = [
    path('login/', LoginView.as_view(), name='auth-login-extended'),
    path('me/', MeView.as_view(), name='auth-me-extended'),
]
