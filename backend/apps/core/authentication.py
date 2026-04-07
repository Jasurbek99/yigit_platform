from rest_framework_simplejwt.authentication import JWTAuthentication
from django.conf import settings


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
        # Mark request so DRF's CSRFCheck skips enforcement for JWT-authed requests.
        request._dont_enforce_csrf_checks = True
        return user, validated_token
