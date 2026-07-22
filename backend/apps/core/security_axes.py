"""Brute-force lockout hardening on top of django-axes.

django-axes gives us detection, an audit trail (``AccessAttempt`` /
``AccessFailureLog``) and a *fixed* cool-off. This module adds the one thing
axes has no built-in for: an **escalating** lockout ladder for one
``(username, IP)`` pair —

* 3 failed logins            -> block for 30 minutes
* 3 more after that unlocks  -> block for 5 hours
* any further episode        -> block for 1 day

How it works
------------
axes couples the block duration to the failure-counting window (both derive
from ``AXES_COOLOFF_TIME``). We keep the ladder *tier* in a separate Redis
counter so the two concerns stay independent:

* :func:`escalating_cooloff` — wired to ``AXES_COOLOFF_TIME``. Returns the block
  length for the current tier of this ``(username, IP)``. axes calls it on every
  failure evaluation, so it MUST be side-effect free.
* :func:`on_user_locked_out` — connected to the axes ``user_locked_out`` signal.
  This is the only hook that fires exactly once per *transition into* lockout:
  ``request.axes_failures_since_start`` is set only on the threshold-crossing
  request, and stays ``None`` on the repeated blocked requests during an active
  block (because ``AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = False`` makes
  axes early-return before touching it). So it is the safe place to bump the
  tier counter.

The tier counter has a sliding 48h TTL and is cleared on a successful login
(:func:`reset_lockout`), so a legitimate user always restarts at tier 1.

Consuming axes' ``user_locked_out`` signal is the library's documented
extension point — not the inter-app Django-signal coordination that
``backend-arch.md`` forbids between our own apps.
"""
from datetime import timedelta

from django.core.cache import cache
from django.http import JsonResponse

from axes.handlers.proxy import AxesProxyHandler
from axes.helpers import get_client_username, get_cool_off


# Escalation ladder: block length per lockout episode for one (username, IP).
# Episode 1 -> 30 min, episode 2 -> 5 h, episode 3+ -> 1 day.
LOCKOUT_LADDER = (
    timedelta(minutes=30),
    timedelta(hours=5),
    timedelta(days=1),
)

# The tier counter resets after this much time without a new lockout episode.
_EPISODE_TTL_SECONDS = int(timedelta(hours=48).total_seconds())


def client_ip(request) -> str | None:
    """Real client IP from nginx's ``X-Real-IP``, falling back to ``REMOTE_ADDR``.

    Wired to ``AXES_CLIENT_IP_CALLABLE`` (checked before django-ipware, so it
    works whether or not ipware is installed). nginx (``frontend/nginx.conf``)
    sets ``X-Real-IP`` to the true client address; the backend otherwise sees
    only the nginx container IP and every user would collapse onto one address.
    ``REMOTE_ADDR`` is the fallback for local/dev access that skips nginx.
    """
    forwarded = request.META.get("HTTP_X_REAL_IP")
    if forwarded:
        return forwarded.strip()
    return request.META.get("REMOTE_ADDR")


def _episode_key(username, ip_address) -> str:
    return f"axes:episode:{username}:{ip_address}"


def _tier_duration(episode: int) -> timedelta:
    """Map a 1-based episode number onto the ladder (clamped to the last tier)."""
    index = min(max(episode, 1), len(LOCKOUT_LADDER)) - 1
    return LOCKOUT_LADDER[index]


def _username_for(request):
    """Username keying the lockout — stashed by the login view, else from axes."""
    return (
        getattr(request, "_login_username", None)
        or get_client_username(request, getattr(request, "axes_credentials", None))
    )


def escalating_cooloff(request) -> timedelta:
    """Block length for the current lockout tier of this ``(username, IP)``.

    Wired to ``AXES_COOLOFF_TIME``. Side-effect free: axes calls it on every
    failure-count evaluation, not only at lockout time.
    """
    username = _username_for(request)
    ip_address = getattr(request, "axes_ip_address", None)
    episode = cache.get(_episode_key(username, ip_address)) or 1
    return _tier_duration(episode)


def on_user_locked_out(sender, request, username, ip_address, **kwargs) -> None:
    """Bump the lockout tier once per episode (axes ``user_locked_out`` signal).

    Fires only on the request that crosses the failure limit: axes leaves
    ``request.axes_failures_since_start`` at ``None`` on the repeated blocked
    requests during an already-active lockout, so those are ignored and the tier
    is not double-counted.
    """
    if getattr(request, "axes_failures_since_start", None) is None:
        return  # blocked-during-lockout, not a fresh transition

    key = _episode_key(username, ip_address)
    if cache.add(key, 1, _EPISODE_TTL_SECONDS):
        return  # first episode -> tier 1, TTL set by add()
    try:
        cache.incr(key)
    except ValueError:
        # Key expired between add() and incr(); restart the ladder at tier 1.
        cache.add(key, 1, _EPISODE_TTL_SECONDS)
        return
    cache.touch(key, _EPISODE_TTL_SECONDS)  # slide the window on each escalation


def lockout_response(request, credentials=None) -> JsonResponse:
    """``AXES_LOCKOUT_CALLABLE`` -> JSON 429 with a ``Retry-After`` header.

    Uses the same ``{"error": ...}`` envelope as the rest of the API so the
    frontend renders it uniformly; ``retry_after`` (seconds) lets the login page
    show a countdown.
    """
    cool_off = get_cool_off(request)
    retry_after = int(cool_off.total_seconds()) if cool_off else None
    payload = {
        "error": "Too many failed login attempts. Please try again later.",
        "detail": "locked_out",
    }
    if retry_after is not None:
        payload["retry_after"] = retry_after
    response = JsonResponse(payload, status=429)
    if retry_after is not None:
        response["Retry-After"] = str(retry_after)
    return response


def reset_lockout(request, username) -> None:
    """Clear axes attempts and the escalation tier after a successful login.

    Our JWT login never calls Django ``login()``, so axes' ``AXES_RESET_ON_SUCCESS``
    (which hooks the ``user_logged_in`` signal) never fires — we reset here.
    """
    ip_address = getattr(request, "axes_ip_address", None)
    AxesProxyHandler.reset_attempts(username=username)
    cache.delete(_episode_key(username, ip_address))
