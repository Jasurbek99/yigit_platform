"""Cookie-JWT auth middleware for Channels.

Mirrors apps.core.authentication.CookieJWTAuthentication but operates on the
ASGI handshake scope instead of a DRF request. The browser sends the
httpOnly `access_token` cookie automatically with the WS upgrade — we read it
out of scope['headers'], validate it with SimpleJWT, and stick the User on
scope['user']. Consumers reject anonymous users with close code 4401.
"""
from http import cookies as http_cookies

from channels.db import database_sync_to_async
from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import UntypedToken


def _parse_cookies(headers: list[tuple[bytes, bytes]]) -> dict[str, str]:
    """Extract cookies from raw ASGI headers (list of [name, value] bytes pairs)."""
    raw = ''
    for name, value in headers:
        if name == b'cookie':
            raw = value.decode('latin-1')
            break
    if not raw:
        return {}
    jar = http_cookies.SimpleCookie()
    try:
        jar.load(raw)
    except http_cookies.CookieError:
        return {}
    return {key: morsel.value for key, morsel in jar.items()}


@database_sync_to_async
def _get_user(token_str: str):
    from apps.core.models import User  # local import — Django apps must be ready

    try:
        token = UntypedToken(token_str)
    except (InvalidToken, TokenError):
        return AnonymousUser()
    user_id = token.payload.get('user_id')
    if not user_id:
        return AnonymousUser()
    try:
        return User.objects.get(pk=user_id, is_active=True)
    except User.DoesNotExist:
        return AnonymousUser()


class CookieJWTAuthMiddleware:
    """Populate scope['user'] from the AUTH_COOKIE JWT."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        cookie_name = settings.SIMPLE_JWT.get('AUTH_COOKIE', 'access_token')
        cookies = _parse_cookies(scope.get('headers', []))
        token = cookies.get(cookie_name)
        scope['user'] = await _get_user(token) if token else AnonymousUser()
        return await self.inner(scope, receive, send)
