# API Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six unprotected `POST` create endpoints safe to retry, so an operator on a flaky KZ/RU network who presses Save twice after a timeout gets one record and the original response, not a duplicate.

**Architecture:** A client-supplied `Idempotency-Key` header, an `IdempotencyKey` row in `core` whose `UniqueConstraint(user, endpoint, key)` resolves the race by insert-before-execute, and a single `@idempotent` decorator applied to six view methods. The stored 2xx response is replayed verbatim on retry. Absent the header, every endpoint behaves exactly as it does today.

**Tech Stack:** Django 5 / DRF, MSSQL (mssql-django), Celery beat, React 18 + TanStack Query + axios, vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-api-idempotency-design.md`

## Global Constraints

- **MSSQL:** no `JSONField`, no `ArrayField`, no `DISTINCT ON`; `bulk_create`/`bulk_update` always `batch_size=500`; `CharField`/`TextField` holding Turkmen or Russian text needs `db_collation='Cyrillic_General_CI_AS'`.
- **Dependency direction:** `core ← greenhouse ← export ← contracts ← finance`. `core` never imports from downstream apps. No Django signals.
- **`models/` packages:** every new model MUST be re-exported from `__init__.py` or `makemigrations` silently ignores it.
- **Migrations:** after `makemigrations`, run `migrate <app>` immediately and confirm with `showmigrations`.
- **i18n:** every user-visible string exists in all three of `frontend/src/i18n/tk.json`, `ru.json`, `en.json`. Never add a key to one file only.
- **TypeScript:** no `any`, no `as` assertions, `I` prefix on interfaces, explicit return types on exported functions.
- **Tests run against a real local MSSQL** (`test_YIGIT_PLATFROM` on `localhost`), not SQLite — concurrency tests therefore exercise real constraint enforcement.
- **Never commit without being told.** Each task ends with a commit step; run it only when the user has said to commit.
- **Type-check command is `npx tsc --noEmit --ignoreDeprecations 5.0`** — `npm run type-check` is broken in this repo (TS5103).

---

### Task 1: `IdempotencyKey` model and migration

**Files:**
- Create: `backend/apps/core/models/idempotency.py`
- Modify: `backend/apps/core/models/__init__.py`
- Create: `backend/apps/core/migrations/0034_idempotencykey.py` (generated)
- Test: `backend/apps/core/tests/test_idempotency.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `apps.core.models.IdempotencyKey` with fields `user` (FK to `core.User`, CASCADE), `endpoint` (CharField 200), `key` (CharField 64), `status_code` (PositiveSmallIntegerField, nullable), `response_body` (TextField, nullable), `created_at` (DateTimeField, auto_now_add). Unique constraint named `uq_idempotency_user_endpoint_key` over `(user, endpoint, key)`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_idempotency.py`:

```python
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.models import IdempotencyKey, User


class IdempotencyKeyModelTest(TestCase):
    """The unique constraint is the whole mechanism — test it directly."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_user', password='x', role='export_manager',
        )
        cls.other = User.objects.create_user(
            username='idem_other', password='x', role='export_manager',
        )

    def test_same_user_endpoint_key_twice_raises(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                IdempotencyKey.objects.create(
                    user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
                )

    def test_same_key_different_endpoint_allowed(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/contracts/', key='abcd1234',
        )
        self.assertEqual(IdempotencyKey.objects.count(), 2)

    def test_same_key_different_user_allowed(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        IdempotencyKey.objects.create(
            user=self.other, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        self.assertEqual(IdempotencyKey.objects.count(), 2)

    def test_new_row_is_in_flight(self):
        record = IdempotencyKey.objects.create(
            user=self.user, endpoint='/api/v1/export/shipments/', key='abcd1234',
        )
        self.assertIsNone(record.status_code)
        self.assertIsNone(record.response_body)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency -v 2
```

Expected: FAIL — `ImportError: cannot import name 'IdempotencyKey' from 'apps.core.models'`.

- [ ] **Step 3: Create the model**

Create `backend/apps/core/models/idempotency.py`:

```python
from django.db import models


class IdempotencyKey(models.Model):
    """One client-declared attempt at one write, with its recorded outcome.

    The UniqueConstraint is the mechanism, not a safety net: the decorator in
    apps/core/idempotency.py INSERTs this row before running the view, so two
    concurrent retries race on the constraint and exactly one wins. A
    check-then-create would let both through.

    status_code IS NULL means the request is still in flight, not that there
    was no response.
    """

    # === Identity of the attempt ===
    user = models.ForeignKey('core.User', on_delete=models.CASCADE)
    endpoint = models.CharField(max_length=200)
    key = models.CharField(max_length=64)

    # === Recorded outcome ===
    # response_body holds rendered JSON. Comment bodies carry Turkmen and
    # Russian text, so the column needs an explicit Cyrillic collation.
    status_code = models.PositiveSmallIntegerField(null=True)
    response_body = models.TextField(
        db_collation='Cyrillic_General_CI_AS', null=True,
    )

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'core_idempotency_keys'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'endpoint', 'key'],
                name='uq_idempotency_user_endpoint_key',
            ),
        ]
        indexes = [models.Index(fields=['created_at'])]

    def __str__(self) -> str:
        return f'{self.user_id}:{self.endpoint}:{self.key}'
```

- [ ] **Step 4: Re-export from the models package**

In `backend/apps/core/models/__init__.py`, add the import after the `work_session` line:

```python
from .idempotency import IdempotencyKey
```

and add `'IdempotencyKey',` to the end of `__all__`.

Without this the model is invisible to `makemigrations` — no error, just a missing migration.

- [ ] **Step 5: Generate and apply the migration**

```bash
cd backend && python manage.py makemigrations core
python manage.py migrate core
python manage.py showmigrations core | tail -5
```

Expected: `0034_idempotencykey` created, applied, and shown with `[X]`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency -v 2
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core/models/idempotency.py backend/apps/core/models/__init__.py \
        backend/apps/core/migrations/0034_idempotencykey.py \
        backend/apps/core/tests/test_idempotency.py
git commit -m "feat(core): add IdempotencyKey model for retry-safe POST creates"
```

---

### Task 2: The `@idempotent` decorator

**Files:**
- Create: `backend/apps/core/idempotency.py`
- Test: `backend/apps/core/tests/test_idempotency_decorator.py`

**Interfaces:**
- Consumes: `apps.core.models.IdempotencyKey` from Task 1.
- Produces: `apps.core.idempotency.idempotent(view_method)` — a decorator for DRF view methods with signature `(self, request, *args, **kwargs) -> Response`. Also exports the module constant `IDEMPOTENCY_HEADER = 'Idempotency-Key'`.

The test module defines a throwaway viewset so the decorator is tested in isolation, before any real endpoint depends on it.

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/core/tests/test_idempotency_decorator.py`:

```python
import json

from django.test import TestCase
from django.urls import path
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.core.models import IdempotencyKey, User

CALLS: list[str] = []


class _ProbeView(APIView):
    """Records every real execution so tests can assert the view ran once."""

    @idempotent
    def post(self, request, *args, **kwargs):
        CALLS.append(request.data.get('marker', ''))
        outcome = request.data.get('outcome', 'ok')
        if outcome == 'bad_request':
            return Response({'error': 'nope'}, status=status.HTTP_400_BAD_REQUEST)
        if outcome == 'boom':
            raise RuntimeError('view exploded')
        return Response({'created': request.data.get('marker', '')},
                        status=status.HTTP_201_CREATED)


urlpatterns = [path('probe/', _ProbeView.as_view())]


@override_settings(ROOT_URLCONF=__name__)
class IdempotentDecoratorTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_dec', password='x', role='export_manager',
        )

    def setUp(self):
        CALLS.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _post(self, body, key=None):
        headers = {'HTTP_IDEMPOTENCY_KEY': key} if key else {}
        return self.client.post('/probe/', body, format='json', **headers)

    def test_no_header_passes_through_and_writes_no_row(self):
        r1 = self._post({'marker': 'a'})
        r2 = self._post({'marker': 'a'})
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(len(CALLS), 2)
        self.assertEqual(IdempotencyKey.objects.count(), 0)

    def test_same_key_twice_runs_view_once_and_replays_body(self):
        r1 = self._post({'marker': 'a'}, key='key-aaaa-1111')
        r2 = self._post({'marker': 'DIFFERENT'}, key='key-aaaa-1111')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(len(CALLS), 1, 'view must execute exactly once')
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(r2.json()['created'], 'a', 'replay returns the FIRST body')

    def test_in_flight_key_returns_409(self):
        IdempotencyKey.objects.create(
            user=self.user, endpoint='/probe/', key='key-bbbb-2222',
        )
        response = self._post({'marker': 'a'}, key='key-bbbb-2222')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()['error'], 'idempotency_in_progress')
        self.assertEqual(len(CALLS), 0)

    def test_validation_400_frees_the_key(self):
        r1 = self._post({'marker': 'a', 'outcome': 'bad_request'}, key='key-cccc-3333')
        self.assertEqual(r1.status_code, 400)
        self.assertEqual(IdempotencyKey.objects.count(), 0,
                         'a rejected request must not burn the key')
        r2 = self._post({'marker': 'fixed'}, key='key-cccc-3333')
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r2.json()['created'], 'fixed')

    def test_exception_keeps_the_key_and_replay_reports_failure(self):
        with self.assertRaises(RuntimeError):
            self._post({'marker': 'a', 'outcome': 'boom'}, key='key-dddd-4444')
        record = IdempotencyKey.objects.get(key='key-dddd-4444')
        self.assertEqual(record.status_code, 500)
        response = self._post({'marker': 'a'}, key='key-dddd-4444')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(len(CALLS), 1,
                         'a half-written create must not run a second time')

    def test_malformed_key_rejected(self):
        for bad in ('short', 'has spaces here', 'x' * 65, 'bad!chars@here'):
            with self.subTest(key=bad):
                response = self._post({'marker': 'a'}, key=bad)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['error'], 'invalid_idempotency_key')
        self.assertEqual(len(CALLS), 0)
        self.assertEqual(IdempotencyKey.objects.count(), 0)
```

Add the missing import at the top of the file:

```python
from django.test import TestCase, override_settings
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency_decorator -v 2
```

Expected: FAIL — `ModuleNotFoundError: No module named 'apps.core.idempotency'`.

- [ ] **Step 3: Write the decorator**

Create `backend/apps/core/idempotency.py`:

```python
"""Retry-safe POST handling via a client-supplied Idempotency-Key header.

The operator-facing problem: on a public network in KZ/RU a Save can reach the
server, succeed, and lose its response. The operator presses Save again and
gets a second truck, a second contract, or a second advance.

The mechanism: INSERT a key row, then run the view. Two concurrent retries race
on the unique constraint and exactly one wins; the loser either replays the
winner's stored response or is told the winner is still running. A
check-then-create would let both through, so the INSERT must come first.
"""

import functools
import json
import logging
import re

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.response import Response

from apps.core.models import IdempotencyKey

logger = logging.getLogger(__name__)

IDEMPOTENCY_HEADER = 'Idempotency-Key'
_META_KEY = 'HTTP_IDEMPOTENCY_KEY'
_KEY_PATTERN = re.compile(r'^[A-Za-z0-9\-]{8,64}$')

# A view that returns one of these rejected the request before writing
# anything, so the key is freed and the operator can fix the form and resubmit
# under the same key. Every other status is recorded and replayed.
_FREEING_STATUSES = frozenset({
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_403_FORBIDDEN,
})


def idempotent(view_method):
    """Make a DRF POST handler safe to retry under the same Idempotency-Key.

    No header means no change in behaviour — existing clients, open browser
    tabs and the future mobile CRM keep working untouched.
    """

    @functools.wraps(view_method)
    def wrapper(self, request, *args, **kwargs):
        key = request.META.get(_META_KEY)
        if not key:
            return view_method(self, request, *args, **kwargs)

        if not _KEY_PATTERN.match(key):
            return Response(
                {'error': 'invalid_idempotency_key'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        endpoint = request.path[:200]
        try:
            with transaction.atomic():
                record = IdempotencyKey.objects.create(
                    user=request.user, endpoint=endpoint, key=key,
                )
        except IntegrityError:
            return _replay(request.user, endpoint, key)

        return _run_and_record(record, view_method, self, request, args, kwargs)

    return wrapper


def _replay(user, endpoint: str, key: str) -> Response:
    """Return the winner's stored response, or 409 if it is still running."""
    record = IdempotencyKey.objects.filter(
        user=user, endpoint=endpoint, key=key,
    ).first()
    # record is None when the winner was rejected (400/403) and freed the key
    # between our failed INSERT and this read. Telling the client to retry is
    # correct there too.
    if record is None or record.status_code is None:
        return Response(
            {'error': 'idempotency_in_progress'},
            status=status.HTTP_409_CONFLICT,
        )
    body = json.loads(record.response_body) if record.response_body else {}
    logger.info('Idempotent replay: %s %s -> %s', endpoint, key, record.status_code)
    return Response(body, status=record.status_code)


def _run_and_record(record, view_method, view, request, args, kwargs) -> Response:
    """Execute the view and persist its outcome against the key."""
    try:
        response = view_method(view, request, *args, **kwargs)
    except Exception:
        # ATOMIC_REQUESTS is off and these views write across several models
        # before they can fail, so a partial write may already be on disk.
        # Keeping the key stops a blind retry from re-running it.
        _record(record, 500, {'error': 'server_error'})
        raise

    if response.status_code in _FREEING_STATUSES:
        record.delete()
        return response

    if response.status_code >= 500:
        _record(record, response.status_code, {'error': 'server_error'})
        return response

    _record(record, response.status_code, response.data)
    return response


def _record(record, status_code: int, body) -> None:
    """Persist the outcome, never masking the caller's own exception."""
    try:
        record.status_code = status_code
        # default=str renders Decimal and date the way DRF's JSON renderer
        # would, so a replayed body matches the original byte for byte.
        record.response_body = json.dumps(body, default=str)
        record.save(update_fields=['status_code', 'response_body'])
    except Exception:
        logger.exception('Failed to record idempotency outcome for key %s', record.key)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency_decorator -v 2
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/idempotency.py \
        backend/apps/core/tests/test_idempotency_decorator.py
git commit -m "feat(core): add @idempotent decorator for retry-safe POST handlers"
```

---

### Task 3: Concurrency test — two simultaneous retries

**Files:**
- Create: `backend/apps/core/tests/test_idempotency_concurrency.py`

**Interfaces:**
- Consumes: `apps.core.idempotency.idempotent` and `apps.core.models.IdempotencyKey`.
- Produces: nothing consumed downstream.

This is a separate task because a sequential-retry test passes even against a `filter().exists()` implementation. Only a parallel test can prove the insert-first design actually holds. `TransactionTestCase` is required — `TestCase` wraps each test in a transaction the worker threads cannot see into.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_idempotency_concurrency.py`:

```python
import threading

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.urls import path
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.core.models import IdempotencyKey, User

EXECUTIONS: list[int] = []
_GATE = threading.Barrier(2, timeout=10)


class _SlowProbeView(APIView):
    """Both threads are held at the barrier so their INSERTs really collide."""

    @idempotent
    def post(self, request, *args, **kwargs):
        _GATE.wait()
        EXECUTIONS.append(1)
        return Response({'ok': True}, status=status.HTTP_201_CREATED)


urlpatterns = [path('slow-probe/', _SlowProbeView.as_view())]


@override_settings(ROOT_URLCONF=__name__)
class IdempotencyConcurrencyTest(TransactionTestCase):
    def setUp(self):
        EXECUTIONS.clear()
        self.user = User.objects.create_user(
            username='idem_race', password='x', role='export_manager',
        )

    def test_two_simultaneous_requests_execute_the_view_once(self):
        results: list[int] = []

        def fire():
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                response = client.post(
                    '/slow-probe/', {}, format='json',
                    HTTP_IDEMPOTENCY_KEY='race-key-000001',
                )
                results.append(response.status_code)
            finally:
                # Each thread opens its own connection; Django does not close
                # them and TransactionTestCase teardown would hang otherwise.
                connection.close()

        threads = [threading.Thread(target=fire) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        self.assertEqual(len(results), 2, 'both requests must return')
        self.assertEqual(
            len(EXECUTIONS), 1,
            'the view body must execute exactly once across both threads',
        )
        self.assertEqual(
            IdempotencyKey.objects.filter(key='race-key-000001').count(), 1,
        )
        # The loser sees the winner mid-flight (409) or already finished (201).
        self.assertIn(sorted(results), ([201, 201], [201, 409]))
```

Note on the barrier: the winner's view body waits at `_GATE.wait()` until the loser also arrives, which guarantees the loser's INSERT happens while the winner is still in flight. Both `[201, 201]` and `[201, 409]` are correct outcomes depending on which side of the winner's `_record()` the loser's read lands.

- [ ] **Step 2: Run the test**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency_concurrency -v 2
```

Expected: PASS against the Task 2 implementation.

- [ ] **Step 3: Back up the decorator before breaking it**

```bash
cp backend/apps/core/idempotency.py "$SCRATCH/idempotency.py.bak"
```

Use the session scratchpad directory. **Do not plan to restore this file with `git checkout`** — Task 2's commit step will not have run (nothing is committed without the user saying so), so the file is untracked and `git checkout` would delete it outright.

- [ ] **Step 4: Prove the test has teeth (RED-on-revert check)**

Temporarily replace the INSERT in `apps/core/idempotency.py` with a check-then-create:

```python
        # TEMPORARY — must make the concurrency test fail
        existing = IdempotencyKey.objects.filter(
            user=request.user, endpoint=endpoint, key=key,
        ).first()
        if existing is not None:
            return _replay(request.user, endpoint, key)
        record = IdempotencyKey.objects.create(
            user=request.user, endpoint=endpoint, key=key,
        )
```

Run the concurrency test again.

Expected: **FAIL** — `len(EXECUTIONS)` is 2, or an `IntegrityError` surfaces. If it passes, the test is not exercising the race and must be fixed before proceeding.

- [ ] **Step 5: Restore the decorator from the backup**

```bash
cp "$SCRATCH/idempotency.py.bak" backend/apps/core/idempotency.py
cd backend && python manage.py test apps.core.tests.test_idempotency_concurrency -v 2
```

Expected: PASS again. Diff the restored file against the Task 2 listing before moving on — a half-reverted decorator would make every later task's tests lie.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/tests/test_idempotency_concurrency.py
git commit -m "test(core): prove @idempotent survives two simultaneous retries"
```

---

### Task 4: Wire the three `export` endpoints

**Files:**
- Modify: `backend/apps/export/views.py` — `ShipmentViewSet.create` (~line 1746), `comment` action (~line 2566), `CommentViewSet` (class at ~line 3416)
- Test: `backend/apps/export/tests_idempotency_endpoints.py`

**Interfaces:**
- Consumes: `from apps.core.idempotency import idempotent`.
- Produces: nothing consumed downstream.

`export` importing from `core` follows the dependency direction.

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/export/tests_idempotency_endpoints.py`. The fixture helpers below are copied from `apps/export/tests_draft_promote.py:39-62` and `:200-202`, which is the working pattern for shipment-create tests in this app.

```python
"""Idempotency smoke tests for the export app's covered create endpoints."""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    Country, Customer, Season, ShipmentStatusType, User,
)
from apps.export.models import Shipment, ShipmentComment

SHIPMENTS_URL = '/api/v1/export/shipments/'
COMMENTS_URL = '/api/v1/export/comments/'


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025',
        defaults={'start_date': '2025-01-01', 'end_date': '2025-12-31',
                  'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
                  'step_order': step_order, 'phase': 'PREP'},
    )
    return obj


class ShipmentCreateIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _make_status('draft', 0, 'Draft')
        _make_status('yuklenme', 1, 'Loading')
        cls.user = _make_user('idem_em', 'export_manager')
        cls.season = _make_season()
        cls.country = Country.objects.create(
            name_tk='Kazakhstan', name_en='Kazakhstan',
            name_ru='Казахстан', code='KZ',
        )
        cls.customer = Customer.objects.create(name='IdemCustomer')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _payload(self) -> dict:
        return {'country': self.country.id, 'customer': self.customer.id,
                'season': self.season.id}

    def test_repeated_create_yields_one_shipment(self):
        r1 = self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                              HTTP_IDEMPOTENCY_KEY='ship-key-000001')
        r2 = self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                              HTTP_IDEMPOTENCY_KEY='ship-key-000001')

        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r1.json()['shipment_code'], r2.json()['shipment_code'])
        self.assertEqual(Shipment.objects.count(), 1)

    def test_different_keys_yield_two_shipments(self):
        self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                         HTTP_IDEMPOTENCY_KEY='ship-key-000001')
        self.client.post(SHIPMENTS_URL, self._payload(), format='json',
                         HTTP_IDEMPOTENCY_KEY='ship-key-000002')
        self.assertEqual(Shipment.objects.count(), 2)

    def test_no_header_still_creates_two(self):
        """Absence of the header must not change existing behaviour."""
        self.client.post(SHIPMENTS_URL, self._payload(), format='json')
        self.client.post(SHIPMENTS_URL, self._payload(), format='json')
        self.assertEqual(Shipment.objects.count(), 2)


class CommentIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        _make_status('draft', 0, 'Draft')
        cls.user = _make_user('idem_cmt', 'export_manager')
        cls.season = _make_season()
        cls.shipment = Shipment.objects.create(
            shipment_code='0108001/26',
            date='2026-08-01',
            season=cls.season,
            status=ShipmentStatusType.objects.get(code='draft'),
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_comment_viewset_create_yields_one_comment(self):
        payload = {'shipment': self.shipment.id, 'content': 'hello'}
        r1 = self.client.post(COMMENTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='cmt-key-000001')
        r2 = self.client.post(COMMENTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='cmt-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(ShipmentComment.objects.count(), 1)

    def test_repeated_legacy_comment_action_yields_one_comment(self):
        url = f'{SHIPMENTS_URL}{self.shipment.id}/comment/'
        self.client.post(url, {'content': 'hi'}, format='json',
                         HTTP_IDEMPOTENCY_KEY='cmt-key-000002')
        self.client.post(url, {'content': 'hi'}, format='json',
                         HTTP_IDEMPOTENCY_KEY='cmt-key-000002')
        self.assertEqual(ShipmentComment.objects.count(), 1)
```

If `Shipment.objects.create(...)` in `CommentIdempotencyTest` rejects a missing required field, copy the exact `_make_draft()` construction from `tests_draft_promote.py:204-215` instead — do not invent field values.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python manage.py test apps.export.tests_idempotency_endpoints -v 2
```

Expected: FAIL — two shipments / two comments created.

- [ ] **Step 3: Add the import to `views.py`**

In the project-app import block near the top of `backend/apps/export/views.py`:

```python
from apps.core.idempotency import idempotent
```

- [ ] **Step 4: Decorate `ShipmentViewSet.create`**

At `backend/apps/export/views.py:1746`, put the decorator directly above the existing method:

```python
    @idempotent
    def create(self, request, *args, **kwargs):
```

- [ ] **Step 5: Decorate the legacy `comment` action**

At `backend/apps/export/views.py:2566`. `@action` must stay outermost — DRF reads routing attributes off the outermost function object:

```python
    @action(detail=True, methods=['post'], url_path='comment')
    @idempotent
    def comment(self, request, pk=None):
```

- [ ] **Step 6: Add a `create` override to `CommentViewSet`**

`CommentViewSet` (class at `backend/apps/export/views.py:3416`) has only `perform_create`, so there is nothing to decorate. Add a thin override immediately above the existing `perform_create` at line ~3540:

```python
    @idempotent
    def create(self, request, *args, **kwargs):
        """Retry-safe create — the body is unchanged, see apps/core/idempotency.py."""
        return super().create(request, *args, **kwargs)
```

- [ ] **Step 7: Run the new tests**

```bash
cd backend && python manage.py test apps.export.tests_idempotency_endpoints -v 2
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Run the export suite for regressions**

```bash
cd backend && python manage.py test apps.export -v 1 2>&1 | tail -20
```

Expected: no NEW failures. The suite has ~71 known pre-existing failures across four buckets — compare against a baseline captured on `main` before judging.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/export/views.py backend/apps/export/tests_idempotency_endpoints.py
git commit -m "feat(p3): make shipment and comment creates retry-safe"
```

---

### Task 5: Wire the `finance` and `contracts` endpoints

**Files:**
- Modify: `backend/apps/export/views_finance.py` — advances `create` (~line 148), customs-expenses `create` (~line 428)
- Modify: `backend/apps/contracts/views.py` — `ContractViewSet` (~line 69)
- Test: `backend/apps/contracts/tests/test_idempotency.py`
- Test: append to `backend/apps/export/tests_idempotency_endpoints.py`

**Interfaces:**
- Consumes: `from apps.core.idempotency import idempotent`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/export/tests_idempotency_endpoints.py`. Field names come from `apps/export/models/finance.py:9-42` (`FinansistAdvance`) and `:155-190` (`CustomsExpense`); the write roles are `ADVANCE_WRITE = {'admin', 'finansist', 'director'}` (`apps/core/roles.py:79`) and `CUSTOMS_EXPENSE_WRITE = ADVANCE_WRITE | {'document_team', 'export_manager'}` (`views_finance.py:341`).

```python
ADVANCES_URL = '/api/v1/export/advances/'
EXPENSES_URL = '/api/v1/export/customs-expenses/'


class AdvanceIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('idem_fin', 'finansist')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_advance_create_yields_one_advance(self):
        payload = {'advance_date': '2026-08-10', 'total_amount': '1000.00',
                   'currency': 'USD'}
        r1 = self.client.post(ADVANCES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='adv-key-000001')
        r2 = self.client.post(ADVANCES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='adv-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(FinansistAdvance.objects.count(), 1)


class CustomsExpenseIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('idem_exp', 'finansist')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_expense_create_yields_one_expense(self):
        # 'OTHER' is CustomsExpenseCategory.OTHER — the choices are uppercase
        # (apps/export/models/finance.py:134-149).
        payload = {'expense_date': '2026-08-10', 'amount': '250.00',
                   'currency': 'TMT', 'category': 'OTHER'}
        r1 = self.client.post(EXPENSES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='exp-key-000001')
        r2 = self.client.post(EXPENSES_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='exp-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.json(), r1.json())
        self.assertEqual(CustomsExpense.objects.count(), 1)
```

Extend the model import at the top of the file to:

```python
from apps.export.models import (
    CustomsExpense, FinansistAdvance, Shipment, ShipmentComment,
)
```

`category` must be a real member of `CustomsExpenseCategory` (`apps/export/models/finance.py:134`) — open that enum and use an actual value rather than the `'other'` placeholder above if it does not exist.

Create `backend/apps/contracts/tests/test_idempotency.py`. `Contract.export_firm` and `Contract.import_firm` are both required non-null FKs (`apps/contracts/models/contract.py:66-75`); `season` and `customer` are nullable. `contract_number` is auto-generated server-side, which is exactly why a retry duplicates.

**The URL is `/api/v1/contracts/contracts/`** — `config/urls.py:16` mounts the app at `api/v1/contracts/` and `apps/contracts/urls.py:16` registers the router at `contracts`.

```python
"""Idempotency smoke test for contract creation."""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.contracts.models import Contract
from apps.core.models import ExportFirm, ImportFirm, User

CONTRACTS_URL = '/api/v1/contracts/contracts/'


class ContractIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = User.objects.create_user(
            username='idem_ctr', password='pw', role='export_manager',
        )
        # ExportFirm has NO `name` field: `code` and `name_tk` are the required
        # ones (apps/core/models/firms.py:8-11).
        cls.export_firm = ExportFirm.objects.create(code='IDX', name_tk='IdemExport')
        cls.import_firm = ImportFirm.objects.create(name_company='IdemImport')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_contract_create_yields_one_contract(self):
        payload = {'export_firm': self.export_firm.id,
                   'import_firm': self.import_firm.id}
        r1 = self.client.post(CONTRACTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='ctr-key-000001')
        r2 = self.client.post(CONTRACTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='ctr-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r1.json()['contract_number'], r2.json()['contract_number'])
        self.assertEqual(Contract.objects.count(), 1)
```

If `ExportFirm.objects.create(...)` rejects these kwargs, copy the exact firm construction from `apps/contracts/tests/test_contract_number.py` — do not invent field values. If the create returns 400 for a missing required field, add it from `ContractSerializer` rather than from the model.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python manage.py test apps.export.tests_idempotency_endpoints apps.contracts.tests.test_idempotency -v 2
```

Expected: FAIL — duplicate rows created.

- [ ] **Step 3: Decorate the two finance creates**

Add to the import block in `backend/apps/export/views_finance.py`:

```python
from apps.core.idempotency import idempotent
```

Then at line ~148 and line ~428, above each existing `def create`:

```python
    @idempotent
    def create(self, request, *args, **kwargs):
```

- [ ] **Step 4: Add a `create` override to `ContractViewSet`**

Add to the import block in `backend/apps/contracts/views.py`:

```python
from apps.core.idempotency import idempotent
```

`ContractViewSet` has only `perform_create` (line ~69), so add a thin override directly above it:

```python
    @idempotent
    def create(self, request, *args, **kwargs):
        """Retry-safe create — the body is unchanged, see apps/core/idempotency.py."""
        return super().create(request, *args, **kwargs)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && python manage.py test apps.export.tests_idempotency_endpoints apps.contracts.tests.test_idempotency -v 2
```

Expected: PASS, 7 tests total across both modules.

- [ ] **Step 6: Run the contracts and export suites**

```bash
cd backend && python manage.py test apps.contracts apps.export -v 1 2>&1 | tail -20
```

Expected: no NEW failures against the pre-existing baseline.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/views_finance.py backend/apps/contracts/views.py \
        backend/apps/export/tests_idempotency_endpoints.py \
        backend/apps/contracts/tests/test_idempotency.py
git commit -m "feat(p4): make advance, customs-expense and contract creates retry-safe"
```

---

### Task 6: Daily cleanup of expired keys

**Files:**
- Create: `backend/apps/core/tasks.py`
- Modify: `backend/config/settings.py` — `CELERY_BEAT_SCHEDULE` (~line 447)
- Test: `backend/apps/core/tests/test_idempotency_cleanup.py`

**Interfaces:**
- Consumes: `apps.core.models.IdempotencyKey`.
- Produces: `apps.core.tasks.purge_expired_idempotency_keys() -> int` — a Celery task returning the number of rows deleted.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_idempotency_cleanup.py`:

```python
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import IdempotencyKey, User
from apps.core.tasks import purge_expired_idempotency_keys


class PurgeExpiredIdempotencyKeysTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='idem_purge', password='x', role='export_manager',
        )

    def _make(self, key: str, age_hours: int) -> IdempotencyKey:
        record = IdempotencyKey.objects.create(
            user=self.user, endpoint='/probe/', key=key,
        )
        # created_at is auto_now_add, so age has to be forced with an update.
        IdempotencyKey.objects.filter(pk=record.pk).update(
            created_at=timezone.now() - timedelta(hours=age_hours),
        )
        return record

    def test_deletes_only_rows_older_than_24h(self):
        self._make('fresh-key-0001', age_hours=1)
        self._make('stale-key-0001', age_hours=25)
        self._make('stale-key-0002', age_hours=200)

        deleted = purge_expired_idempotency_keys()

        self.assertEqual(deleted, 2)
        remaining = list(IdempotencyKey.objects.values_list('key', flat=True))
        self.assertEqual(remaining, ['fresh-key-0001'])

    def test_is_safe_to_run_on_an_empty_table(self):
        self.assertEqual(purge_expired_idempotency_keys(), 0)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency_cleanup -v 2
```

Expected: FAIL — `ModuleNotFoundError: No module named 'apps.core.tasks'`.

- [ ] **Step 3: Write the task**

Create `backend/apps/core/tasks.py`:

```python
"""Periodic maintenance for core-owned tables."""

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from apps.core.models import IdempotencyKey

logger = logging.getLogger(__name__)

IDEMPOTENCY_KEY_TTL_HOURS = 24


@shared_task
def purge_expired_idempotency_keys() -> int:
    """Delete idempotency keys past their TTL. Returns the row count."""
    cutoff = timezone.now() - timedelta(hours=IDEMPOTENCY_KEY_TTL_HOURS)
    deleted, _ = IdempotencyKey.objects.filter(created_at__lt=cutoff).delete()
    if deleted:
        logger.info('Purged %d expired idempotency keys', deleted)
    return deleted
```

- [ ] **Step 4: Register the beat schedule**

In `backend/config/settings.py`, add to `CELERY_BEAT_SCHEDULE` (~line 447) alongside `poll-traccar-positions`:

```python
    'purge-expired-idempotency-keys': {
        'task': 'apps.core.tasks.purge_expired_idempotency_keys',
        'schedule': 86400.0,
        'options': {'expires': 3600},
    },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && python manage.py test apps.core.tests.test_idempotency_cleanup -v 2
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/tasks.py backend/config/settings.py \
        backend/apps/core/tests/test_idempotency_cleanup.py
git commit -m "chore(core): purge idempotency keys older than 24h on a daily beat"
```

---

### Task 7: `useIdempotencyKey` hook

**Files:**
- Create: `frontend/src/hooks/useIdempotencyKey.ts`
- Test: `frontend/src/hooks/useIdempotencyKey.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useIdempotencyKey(): { key: string; reset: () => void }` and `IDEMPOTENCY_HEADER: 'Idempotency-Key'`, both named exports.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useIdempotencyKey.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIdempotencyKey } from './useIdempotencyKey';

describe('useIdempotencyKey', () => {
  it('keeps the same key across re-renders', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    rerender();
    rerender();
    expect(result.current.key).toBe(first);
  });

  it('issues a new key after reset', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    act(() => result.current.reset());
    rerender();
    expect(result.current.key).not.toBe(first);
  });

  it('gives separate hook instances separate keys', () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it('produces a key the backend regex accepts', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.key).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('works without crypto.randomUUID (plain-HTTP beta)', () => {
    const original = globalThis.crypto.randomUUID;
    // Beta serves over plain HTTP, where randomUUID is undefined.
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined, configurable: true,
    });
    try {
      const { result } = renderHook(() => useIdempotencyKey());
      expect(result.current.key).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original, configurable: true,
      });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/hooks/useIdempotencyKey.test.ts
```

Expected: FAIL — cannot resolve `./useIdempotencyKey`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/hooks/useIdempotencyKey.ts`:

```typescript
import { useRef } from 'react';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * crypto.randomUUID() only exists in a secure context. Beta serves over plain
 * HTTP at 10.10.11.25:8080, where it is undefined — without this fallback
 * idempotency would be silently dead on the one server where it gets tested.
 */
function newKey(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IIdempotencyKey {
  key: string;
  reset: () => void;
}

/**
 * A key that survives re-renders, so pressing Save again after a timeout
 * reuses it and the server replays the original response instead of creating
 * a second record.
 *
 * Call one instance PER MUTATION. Sharing an instance between two different
 * mutations that POST to the same path makes the second one silently receive
 * the first one's response and never create its own record.
 */
export function useIdempotencyKey(): IIdempotencyKey {
  const ref = useRef<string>(newKey());
  return {
    key: ref.current,
    reset: (): void => {
      ref.current = newKey();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/hooks/useIdempotencyKey.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Type-check**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors. (`npm run type-check` is broken in this repo — do not use it.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useIdempotencyKey.ts frontend/src/hooks/useIdempotencyKey.test.ts
git commit -m "feat(frontend): add useIdempotencyKey hook with plain-HTTP fallback"
```

---

### Task 8: Wire the six shipment-create call sites

**Files:**
- Modify: `frontend/src/components/ShipmentCreateModal.tsx:72`
- Modify: `frontend/src/hooks/useSheetCreate.ts:23`
- Modify: `frontend/src/hooks/useDrafts.ts:86`, `:234`, `:285`, `:327`
- Test: `frontend/src/hooks/useDrafts.idempotency.test.tsx`

**Interfaces:**
- Consumes: `useIdempotencyKey`, `IDEMPOTENCY_HEADER` from Task 7.
- Produces: nothing consumed downstream.

`useDrafts.ts` holds four separate mutations that all POST to `/export/shipments/`. Since the server's uniqueness tuple is `(user, path, key)` and the path is identical for all four, the key is the only thing distinguishing them. **Each mutation gets its own `useIdempotencyKey()` call.** Hoisting one to hook or module scope collapses two genuinely different draft creates into one — silently.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useDrafts.idempotency.test.tsx` (`.tsx` — it defines a JSX wrapper):

```tsx
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '@/services/api';
import { useCreateDraft, useCreateEmptyColumn } from './useDrafts';

vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function keyOf(callIndex: number): string | undefined {
  const config = vi.mocked(api.post).mock.calls[callIndex]?.[2];
  return config?.headers?.['Idempotency-Key'] as string | undefined;
}

const DRAFT_PAYLOAD = {
  shipment_code: '1008001/26',
  date: '2026-08-10',
  block_sources: [{ block_id: 1, weight_kg: 18000 }],
};

describe('draft creates carry idempotency keys', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('reuses ONE key when the same mutation is submitted twice', async () => {
    // Reject both calls so onSuccess never fires and reset() never runs —
    // this is exactly the timeout-then-retry case the feature exists for.
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useCreateDraft(), { wrapper });

    result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBeDefined();
    expect(keyOf(0)).toBe(keyOf(1));
  });

  it('uses DIFFERENT keys for two DIFFERENT draft mutations', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 1 } });
    const draft = renderHook(() => useCreateDraft(), { wrapper });
    const column = renderHook(() => useCreateEmptyColumn(), { wrapper });

    draft.result.current.mutate(DRAFT_PAYLOAD);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    column.result.current.mutate();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toBeDefined();
    expect(keyOf(1)).toBeDefined();
    expect(keyOf(0)).not.toBe(keyOf(1));
  });
});
```

The second test is the one that matters. The first passes even against a key hoisted to module scope; only the second catches that mistake.

Both hooks short-circuit into a `USE_MOCK` branch that never calls `api.post` (`useDrafts.ts:63`, `:267`). If `USE_MOCK` is truthy under vitest, `api.post` is never called and both tests fail at the first `waitFor`. Check how `USE_MOCK` is derived at the top of `useDrafts.ts` and, if needed, stub the env flag off in this test file before touching anything else.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/hooks/useDrafts.idempotency.test.tsx
```

Expected: FAIL — no `Idempotency-Key` header is sent, so `keyOf()` returns `undefined`.

- [ ] **Step 3: Wire `ShipmentCreateModal.tsx`**

At `frontend/src/components/ShipmentCreateModal.tsx:72`:

```typescript
  const idem = useIdempotencyKey();
  const createMutation = useMutation({
    mutationFn: async (payload: IShipmentCreatePayload) => {
      await api.post('/export/shipments/', payload, {
        headers: { [IDEMPOTENCY_HEADER]: idem.key },
      });
    },
    onSuccess: () => {
      idem.reset();
      // ... existing onSuccess body, unchanged ...
    },
  });
```

Add the import:

```typescript
import { IDEMPOTENCY_HEADER, useIdempotencyKey } from '@/hooks/useIdempotencyKey';
```

- [ ] **Step 4: Wire `useSheetCreate.ts`**

Apply the identical shape at `frontend/src/hooks/useSheetCreate.ts:23` — one `useIdempotencyKey()` inside the hook body, the header on the `api.post` config, `idem.reset()` as the first line of `onSuccess`.

- [ ] **Step 5: Wire the four `useDrafts.ts` mutations**

At `frontend/src/hooks/useDrafts.ts:86`, `:234`, `:285`, `:327`. Each of the four hooks declares **its own** `const idem = useIdempotencyKey();` inside its own hook body. Do not lift a shared key to module scope or to a parent hook.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/hooks/useDrafts.idempotency.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Run the full frontend suite and type-check**

```bash
cd frontend && npx vitest run 2>&1 | tail -20
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ShipmentCreateModal.tsx frontend/src/hooks/useSheetCreate.ts \
        frontend/src/hooks/useDrafts.ts frontend/src/hooks/useDrafts.idempotency.test.tsx
git commit -m "feat(frontend): send idempotency keys on all six shipment-create paths"
```

---

### Task 9: Wire the remaining five call sites, the interceptor and i18n

**Files:**
- Modify: `frontend/src/hooks/useComments.ts:84`
- Modify: `frontend/src/components/CommentComposer.tsx:26`
- Modify: `frontend/src/hooks/useContracts.ts:79`
- Modify: `frontend/src/hooks/useAdvances.ts:123` (`useCreateAdvance`)
- Modify: `frontend/src/hooks/useCustomsExpenses.ts:74`
- Modify: `frontend/src/services/api.ts:59`
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`
- Test: `frontend/src/services/api.idempotency.test.ts`

**Interfaces:**
- Consumes: `useIdempotencyKey`, `IDEMPOTENCY_HEADER` from Task 7.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

The interceptor's error branch is currently an anonymous inline callback, which cannot be reached from a test without a full HTTP mock. Extract it into a named export first — the same shape `useShipmentPatch.ts` already uses for `extractPatchError`, which is unit-tested that way.

Create `frontend/src/services/api.idempotency.test.ts`:

```typescript
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleApiResponseError } from './api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function conflict(body: unknown): AxiosError {
  return {
    config: { url: '/export/shipments/' },
    response: { status: 409, data: body },
  } as unknown as AxiosError;
}

describe('handleApiResponseError — 409 branches', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset();
  });

  it('toasts on 409 idempotency_in_progress', () => {
    handleApiResponseError(conflict({ error: 'idempotency_in_progress' }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('still toasts on 409 season_closed', () => {
    handleApiResponseError(conflict({ error: 'season_closed' }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('stays silent on an unrelated 409', () => {
    handleApiResponseError(conflict({ error: 'something_else' }));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/services/api.idempotency.test.ts
```

Expected: FAIL — no toast fires for `idempotency_in_progress`.

- [ ] **Step 3: Extract the error handler and add the new branch**

In `frontend/src/services/api.ts`, add the type guard beside the existing `isSeasonClosedError`:

```typescript
interface IIdempotencyInProgressError {
  error: 'idempotency_in_progress';
}

function isIdempotencyInProgress(data: unknown): data is IIdempotencyInProgressError {
  return typeof data === 'object' && data !== null && 'error' in data
    && data.error === 'idempotency_in_progress';
}
```

Then lift the interceptor's inline error callback into a named export, keeping the existing
comment block above it and its behaviour byte-for-byte, plus one new branch:

```typescript
export function handleApiResponseError(error: AxiosError): void {
  const url = error.config?.url ?? '';
  const isLoginRequest = url.includes('/auth/login');
  if (error.response?.status === 401 && !isLoginRequest) {
    window.location.href = '/login';
  }
  if (error.response?.status === 409 && isSeasonClosedError(error.response.data)) {
    toast.error(i18n.t('season.closed_error'));
  }
  // A 409 here means the FIRST attempt is still running, so the operator must
  // wait rather than press Save a third time.
  if (error.response?.status === 409 && isIdempotencyInProgress(error.response.data)) {
    toast.error(i18n.t('common.request_in_progress'));
  }
}
```

and reduce the interceptor to:

```typescript
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    handleApiResponseError(error);
    return Promise.reject(error);
  },
);
```

The extraction is what makes the branch testable — the anonymous callback cannot be reached from a test without a full HTTP mock.

- [ ] **Step 4: Add the i18n key to all three files**

`frontend/src/i18n/tk.json` under `common`:

```json
"request_in_progress": "Bu haýyş eýýäm işlenip barýar — birsalym garaşyň"
```

`frontend/src/i18n/ru.json` under `common`:

```json
"request_in_progress": "Запрос уже обрабатывается — подождите немного"
```

`frontend/src/i18n/en.json` under `common`:

```json
"request_in_progress": "This request is already being processed — please wait"
```

- [ ] **Step 5: Wire the five remaining call sites**

Apply the Task 8 shape — one `useIdempotencyKey()` per mutation, header on the `api.post` config, `idem.reset()` first in `onSuccess` — at:

- `frontend/src/hooks/useComments.ts:84` (create comment)
- `frontend/src/components/CommentComposer.tsx:26` (legacy comment action)
- `frontend/src/hooks/useContracts.ts:79` (create contract)
- `frontend/src/hooks/useAdvances.ts:123` (`useCreateAdvance` — **not** `useLinkShipmentToAdvance` at `:151`, which targets a different endpoint and is out of scope)
- `frontend/src/hooks/useCustomsExpenses.ts:74` (create expense)

`CommentComposer.tsx` is a component, not a hook, but `useIdempotencyKey()` is a hook call and belongs at the top of the component body with the other hooks.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/services/api.idempotency.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Run the full frontend suite and type-check**

```bash
cd frontend && npx vitest run 2>&1 | tail -20
npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/useComments.ts frontend/src/components/CommentComposer.tsx \
        frontend/src/hooks/useContracts.ts frontend/src/hooks/useAdvances.ts \
        frontend/src/hooks/useCustomsExpenses.ts frontend/src/services/api.ts \
        frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json \
        frontend/src/services/api.idempotency.test.ts
git commit -m "feat(frontend): send idempotency keys on comment, contract and finance creates"
```

---

### Task 10: Documentation

**Files:**
- Create: `docs/obsidian/reference/api-idempotency.md`
- Modify: `docs/obsidian/reference/api-endpoint-map.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

**Interfaces:**
- Consumes: the finished implementation.
- Produces: nothing.

- [ ] **Step 1: Write the Obsidian reference page**

Create `docs/obsidian/reference/api-idempotency.md` covering: the `Idempotency-Key` header contract and its `[A-Za-z0-9\-]{8,64}` format; the six covered endpoints; the three outcome branches (2xx recorded and replayed, 400/403 frees the key, 5xx keeps it); the `409 idempotency_in_progress` response; the 24-hour TTL; and the frontend rule that each mutation owns its own key. Follow the structure of the existing pages in `docs/obsidian/reference/`.

- [ ] **Step 2: Note the header in the endpoint map**

In `docs/obsidian/reference/api-endpoint-map.md`, mark the six covered endpoints as accepting `Idempotency-Key` and link to the new page.

- [ ] **Step 3: Add the CHANGELOG entry**

Under `[Unreleased]` → `Added` in `CHANGELOG.md`, Keep-a-Changelog style, newest section on top:

```markdown
- **API idempotency.** Six `POST` create endpoints (shipments, both comment paths, contracts,
  advances, customs expenses) accept an `Idempotency-Key` header. A retry under the same key
  replays the original 201 instead of creating a duplicate — the failure mode was a Save that
  succeeded server-side but lost its response on a flaky network. New `core.IdempotencyKey` model
  + `@idempotent` decorator; keys purged after 24h on a daily Celery beat. `block-sources` and
  `firm-splits` were audited and left alone — both are replace operations and already idempotent
  (feat(core), feat(p3), feat(p4))
```

- [ ] **Step 4: Add the BUILD_TEST_LOG entry**

At the top of `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-08-10 — API idempotency across 6 POST create endpoints (backend decorator + 11 frontend call sites) — NEEDS TEST
```

- [ ] **Step 5: Run the full backend and frontend suites one last time**

```bash
cd backend && python manage.py test apps.core apps.export apps.contracts -v 1 2>&1 | tail -20
cd ../frontend && npx vitest run 2>&1 | tail -20
```

Record the actual pass/fail counts. Compare backend failures against the pre-existing baseline — the suite carries ~71 known failures in four buckets, so report NEW failures specifically rather than a raw total.

- [ ] **Step 6: Commit**

```bash
git add docs/obsidian/reference/api-idempotency.md docs/obsidian/reference/api-endpoint-map.md \
        CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs: record the API idempotency contract and covered endpoints"
```

- [ ] **Step 7: Report to the user**

State plainly: what was built, which suites ran and their counts, that the feature is **built but NOT tested by a human**, and ask whether they tested it. Do not check the `BUILD_TEST_LOG.md` box until they confirm.

---

## Manual verification (after Task 10)

The automated tests cover the mechanism. These two checks cover what they cannot:

1. **Plain-HTTP beta.** Open the app on `http://10.10.11.25:8080`, create a shipment, and confirm in DevTools → Network that the POST carries an `Idempotency-Key` header. This is the `crypto.randomUUID` fallback path; if the header is missing, the fallback is broken and idempotency is dead on beta.
2. **Real retry.** Create a shipment with the network throttled to offline mid-request, then press Save again once the network returns. Exactly one shipment should appear in the list.
