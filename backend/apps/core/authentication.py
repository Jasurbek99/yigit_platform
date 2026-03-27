from rest_framework_simplejwt.authentication import JWTAuthentication
from django.conf import settings


class CookieJWTAuthentication(JWTAuthentication):
    """Read JWT access token from httpOnly cookie instead of Authorization header.

    Users on public networks in KZ/RU — never localStorage (AD-auth).
    """

    def authenticate(self, request):
        cookie_name = getattr(settings, 'SIMPLE_JWT', {}).get('AUTH_COOKIE', 'access_token')
        raw_token = request.COOKIES.get(cookie_name)
        if raw_token is None:
            return None
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
