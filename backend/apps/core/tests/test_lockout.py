"""Brute-force lockout tests (django-axes + escalating ladder).

Exercises the real login endpoint through the full middleware stack so the
AxesMiddleware lockout response and our escalating cool-off callable are both
covered. Time-based escalation is simulated by back-dating AccessAttempt rows
rather than sleeping.
"""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from axes.models import AccessAttempt

from apps.core.models import User
from apps.core.security_axes import escalating_cooloff, _episode_key

LOGIN_URL = '/api/v1/auth/login/'
PASSWORD = 'testpass123'
IP1 = '203.0.113.10'
IP2 = '203.0.113.20'


@override_settings(AXES_ENABLED=True)
class LockoutTestBase(TestCase):
    def setUp(self):
        cache.clear()  # LocMemCache persists across tests in one process
        self.user = User.objects.create_user(username='gadam', password=PASSWORD, role='export_manager')
        self.other = User.objects.create_user(username='bahar', password=PASSWORD, role='warehouse_chief')
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def _login(self, username, password, ip=IP1):
        return self.client.post(
            LOGIN_URL,
            {'username': username, 'password': password},
            format='json',
            HTTP_X_REAL_IP=ip,
        )

    def _fail(self, n, username='gadam', ip=IP1):
        last = None
        for _ in range(n):
            last = self._login(username, 'wrong-password', ip=ip)
        return last

    def _expire_attempts(self, older_than: timedelta):
        """Simulate `older_than` having elapsed since the last failure."""
        AccessAttempt.objects.update(attempt_time=timezone.now() - older_than)


class LockoutBehaviourTest(LockoutTestBase):
    def test_three_failures_lock_the_account(self):
        # First two wrong passwords are plain auth failures...
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)
        # ...the third crosses the limit and is already answered with the lockout.
        self.assertEqual(self._login('gadam', 'nope').status_code, 429)
        # And it stays locked afterwards.
        self.assertEqual(self._login('gadam', 'nope').status_code, 429)

    def test_lockout_response_shape(self):
        self._fail(3)
        resp = self._login('gadam', 'nope')
        self.assertEqual(resp.status_code, 429)
        body = resp.json()
        self.assertEqual(body['detail'], 'locked_out')
        self.assertIn('error', body)
        self.assertEqual(body['retry_after'], 1800)          # tier 1 = 30 min
        self.assertEqual(resp['Retry-After'], '1800')

    def test_correct_password_still_blocked_while_locked(self):
        self._fail(3)
        resp = self._login('gadam', PASSWORD)  # right password, but locked
        self.assertEqual(resp.status_code, 429)


class ResetOnSuccessTest(LockoutTestBase):
    def test_success_before_lockout_resets_attempts(self):
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)
        self.assertEqual(self._login('gadam', PASSWORD).status_code, 200)   # resets
        # Fresh counter: two more failures stay at 401. Without the reset the
        # earlier 2 failures + these would have crossed the limit and returned 429.
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)
        self.assertEqual(self._login('gadam', 'nope').status_code, 401)


class IsolationTest(LockoutTestBase):
    def test_other_user_not_affected_same_ip(self):
        self._fail(3, username='gadam', ip=IP1)
        self.assertEqual(self._login('gadam', 'nope', ip=IP1).status_code, 429)
        # Different username from the same IP is independent.
        self.assertEqual(self._login('bahar', 'nope', ip=IP1).status_code, 401)

    def test_same_user_other_ip_not_affected(self):
        self._fail(3, username='gadam', ip=IP1)
        self.assertEqual(self._login('gadam', 'nope', ip=IP1).status_code, 429)
        # Same username from a different IP is independent.
        self.assertEqual(self._login('gadam', 'nope', ip=IP2).status_code, 401)


class EscalationLadderTest(LockoutTestBase):
    def test_block_length_escalates_30m_5h_1d(self):
        # --- Tier 1: 30 minutes ---
        self._fail(3)
        r1 = self._login('gadam', 'nope')
        self.assertEqual(r1.status_code, 429)
        self.assertEqual(r1.json()['retry_after'], 1800)

        # 30 min pass -> attempts fall out of the window, block lifts.
        self._expire_attempts(timedelta(minutes=31))

        # --- Tier 2: 5 hours (fresh 3 attempts required) ---
        self._fail(3)
        r2 = self._login('gadam', 'nope')
        self.assertEqual(r2.status_code, 429)
        self.assertEqual(r2.json()['retry_after'], 18000)

        # 5 h pass.
        self._expire_attempts(timedelta(hours=5, minutes=1))

        # --- Tier 3: 1 day ---
        self._fail(3)
        r3 = self._login('gadam', 'nope')
        self.assertEqual(r3.status_code, 429)
        self.assertEqual(r3.json()['retry_after'], 86400)


@override_settings(AXES_ENABLED=False)
class AxesDisabledTest(TestCase):
    """With axes off (the test-suite default), login behaves exactly as before."""

    def setUp(self):
        self.user = User.objects.create_user(username='gadam', password=PASSWORD, role='export_manager')
        self.client = APIClient()

    def test_login_succeeds(self):
        resp = self.client.post(
            LOGIN_URL, {'username': 'gadam', 'password': PASSWORD}, format='json',
        )
        self.assertEqual(resp.status_code, 200)

    def test_repeated_failures_never_lock(self):
        for _ in range(6):
            resp = self.client.post(
                LOGIN_URL, {'username': 'gadam', 'password': 'nope'}, format='json',
            )
            self.assertEqual(resp.status_code, 401)


class CooloffCallableUnitTest(TestCase):
    """escalating_cooloff maps the episode counter onto the ladder."""

    class _Req:
        def __init__(self, username, ip):
            self._login_username = username
            self.axes_ip_address = ip
            self.axes_credentials = None

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_ladder_mapping(self):
        req = self._Req('u', '1.1.1.1')
        self.assertEqual(escalating_cooloff(req), timedelta(minutes=30))   # no counter -> tier 1
        cache.set(_episode_key('u', '1.1.1.1'), 1)
        self.assertEqual(escalating_cooloff(req), timedelta(minutes=30))
        cache.set(_episode_key('u', '1.1.1.1'), 2)
        self.assertEqual(escalating_cooloff(req), timedelta(hours=5))
        cache.set(_episode_key('u', '1.1.1.1'), 3)
        self.assertEqual(escalating_cooloff(req), timedelta(days=1))
        cache.set(_episode_key('u', '1.1.1.1'), 9)                          # clamps to last tier
        self.assertEqual(escalating_cooloff(req), timedelta(days=1))
