"""ASGI entry point.

Routes:
    http       → standard Django HTTP (DRF endpoints unchanged)
    websocket  → cookie-JWT-auth middleware → Channels URLRouter
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Initialise Django BEFORE importing anything that touches the ORM
# (channels middleware imports apps.core.User indirectly).
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from apps.core.channels_auth import CookieJWTAuthMiddleware  # noqa: E402
from config.routing import websocket_urlpatterns  # noqa: E402


application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': CookieJWTAuthMiddleware(
        URLRouter(websocket_urlpatterns),
    ),
})
