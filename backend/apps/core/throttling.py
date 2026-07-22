"""Proxy-aware request throttles (flood / DoS backstop).

django-axes (``apps/core/security_axes.py``) already caps *failed logins*. These
throttles cap the *total request rate* — the flood vector axes does not cover:
an authenticated client (or a stolen session) hammering any endpoint, or an
anonymous client spraying the login / public routes.

Behind nginx the backend sees only the nginx container IP, so the stock DRF
throttles would bucket every user onto one address and one client could exhaust
everyone's quota. We reuse the same ``X-Real-IP`` resolution axes uses
(:func:`apps.core.security_axes.client_ip`) so the anonymous bucket is keyed by
the real per-device address.

Rates are configured in ``settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']``
(env-tunable, and set to ``None`` under tests so the suite is unaffected).
Counters live in the shared Redis cache in production, so the limit is enforced
consistently across all gunicorn/uvicorn workers.
"""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from apps.core.security_axes import client_ip


class _ProxyAwareIdentMixin:
    """Key throttle buckets by the real client IP (nginx ``X-Real-IP``)."""

    def get_ident(self, request):
        return client_ip(request) or super().get_ident(request)


class ProxyAwareAnonThrottle(_ProxyAwareIdentMixin, AnonRateThrottle):
    """Per-IP cap for unauthenticated requests (scope ``anon``)."""


class ProxyAwareUserThrottle(_ProxyAwareIdentMixin, UserRateThrottle):
    """Per-user cap for authenticated requests (scope ``user``).

    Authenticated requests key on the user PK, so the proxy IP is irrelevant
    for them; the mixin only affects the anonymous fallback path.
    """
