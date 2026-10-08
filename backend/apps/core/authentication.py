from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.conf import settings

from apps.core.models.user import EXTERNAL_ROLES

# External users (agents and their sellers) may reach only these API trees.
# Checked here because every DRF view authenticates through this class; a view
# that forgot its permission_classes still cannot leak internal data to them.
EXTERNAL_ALLOWED_PREFIXES = ('/api/v1/auth/', '/api/v1/market/')


class CookieJWTAuthentication(JWTAuthentication):
    """Read JWT access token from httpOnly cookie instead of Authorization header.

    Users on public networks in KZ/RU — never localStorage (AD-auth).

    enforce_csrf_checks = False tells DRF's APIView.perform_authentication()
    to skip CSRF for requests authenticated via this class. Without this,
    Django's CsrfViewMiddleware rejects mutating requests (PATCH/PUT/POST)
    because cookie-based auth triggers CSRF enforcement at the middleware level.
    """

    enforce_csrf_checks = False

    def authenticate(self, request):
        cookie_name = getattr(settings, 'SIMPLE_JWT', {}).get('AUTH_COOKIE', 'access_token')
        raw_token = request.COOKIES.get(cookie_name)
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)
        if getattr(user, 'role', None) in EXTERNAL_ROLES and not request.path.startswith(EXTERNAL_ALLOWED_PREFIXES):
            raise PermissionDenied('Not available for this role.')
        # Mark request so DRF's CSRFCheck skips enforcement for JWT-authed requests.
        request._dont_enforce_csrf_checks = True
        return user, validated_token
