"""WebSocket URL routing.

One app-level socket per browser tab. The single AppConsumer multiplexes
all logical channels (presence, future work-time heartbeat, future
notification push) via the envelope `{channel, type, payload}`.
"""
from django.urls import re_path

from apps.core.consumers import AppConsumer


websocket_urlpatterns = [
    re_path(r'^ws/app/$', AppConsumer.as_asgi()),
]
