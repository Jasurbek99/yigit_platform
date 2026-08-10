# API Idempotency — Design

**Date:** 2026-08-10
**Status:** Draft — awaiting review
**Author:** Claude (brainstormed with Jasurbek)

---

## Problem

The API has **no idempotency mechanism**. A `grep` for `Idempot` across the repo returns only
documentation prose and management-command descriptions — no `Idempotency-Key` header handling,
no middleware, no `idempotency_key` field.

What exists today is per-endpoint, ad-hoc:

- `PUT`/`PATCH` are idempotent by DRF's nature.
- Roughly ten call sites across the viewsets deliberately use `get_or_create` /
  `update_or_create` (`views_sheet_settings.py:638`, `views_user_preferences.py:176` and `:206`,
  `views_admin.py:1027`, `views_planning.py:159`, `views_harvest_forecast.py:236` and `:245`,
  `views.py:2554`, `views.py:2650`, `views.py:2708`).
- Management commands are idempotent, but they are not the API.

**`POST` creates are unprotected.** The frontend already guards the trivial double-click —
`disabled`/`loading={isPending}` appears in 80 places across 54 files — so the remaining live
vector is the **retry after timeout**: an operator on a public network in KZ/RU presses Save,
the request reaches the server and succeeds, the response is lost, and the operator presses Save
again 30–60 seconds later. `frontend/src/services/api.ts` sets no axios `timeout`, so the browser
default governs and the retry window is wide.

### Scope decision

Preventive. No duplicates have been confirmed in beta or production data, so **no backfill or
duplicate-hunting command is in scope**.

---

## Affected endpoints (verified in code)

### Tier 1 — server mints the identity, no unique constraint catches the twin

| # | Endpoint | View | Failure on retry |
|---|----------|------|------------------|
| 1 | `POST /export/shipments/` | `views.py:1746` | `generate_shipment_code()` mints a **new** code → two trucks |
| 2 | `POST /contracts/` | `contracts/views.py:69` | `contract_number` (`seq/YY-FIRM-EXP`) minted server-side → **new number, duplicate contract** |
| 3 | `POST` advances | `views_finance.py:148` | `FinansistAdvance` has no unique constraint → **duplicate advance (money)** |
| 4 | `POST` customs-expenses | `views_finance.py:428` | `CustomsExpense` has no unique constraint → **duplicate expense (money)** |
| 5 | `POST /export/comments/` | `views.py:3416` (`CommentViewSet`, `perform_create` at `:3540`) | `ShipmentComment` has no unique constraint → duplicate comment **and duplicate notification fan-out** |
| 6 | `POST /export/shipments/{id}/comment/` | `views.py:2566` | Legacy path into the same service — same failure |

Endpoints 5 and 6 both create comments and both are live on the frontend
(`useComments.ts:84` and `CommentComposer.tsx:26` respectively). Covering only one leaves the
main path open.

### Already idempotent — verified, no work needed

`POST /export/shipments/{id}/block-sources/` (`views.py:2732`) and
`POST /export/shipments/{id}/firm-splits/` (`views.py:2806`) were originally scoped as a second
tier, on the assumption that a retry would collide with `unique_together` and return a raw 400.
**That assumption was wrong.** Both are *replace* operations, not appends:

- `block-sources` calls `write_block_sources(shipment, entries, replace=True)`, and `replace=True`
  deletes the existing rows first (`services/block_sources.py:51-57`).
- `firm-splits` runs `shipment.firm_splits.all().delete()` before inserting (`views.py:2871`).

The unique constraint is never reached. A retry replaces the same set with itself and produces an
identical result, so these two endpoints are already idempotent and are **out of scope**.

### Explicitly out of scope

The other ~60 `POST` handlers are action endpoints (`transition`, `approve`, `reject`, `done`,
`reopen`, `restore`, `soft-delete`, `bulk-*`). A repeat is either a no-op or already idempotent.
Adding key handling there costs tests and buys nothing.

---

## Rejected alternatives

**Server-side content-hash window** (key = `sha256(user + path + canonical body)`, no frontend
change). Rejected: the retry window has to be 2–5 minutes to cover a timeout plus the operator's
reaction, and within five minutes an operator can legitimately file a second identical customs
expense or post a second identical comment. The endpoint would refuse a valid create. That is
worse than a duplicate — a duplicate is visible and deletable, while a refusal reads as "the
system is broken" and sends the operator to enter the data somewhere else.

**Hybrid (header, falling back to content-hash).** Two code paths, two behaviours, double the
tests. Not worth it for eight endpoints.

**Client-generated `shipment_code`** (floated early, dropped). The format is `DDMMNNN/YY` off a
server-side sequence, and `tests_draft_promote.py:158,:174` assert both the format and the
uniqueness of generated codes. Letting the frontend mint it breaks the sequence.

---

## Design

### 1. Model — `apps/core/models/idempotency.py`

```python
class IdempotencyKey(models.Model):
    user          = models.ForeignKey('core.User', on_delete=models.CASCADE)
    endpoint      = models.CharField(max_length=200)   # request.path
    key           = models.CharField(max_length=64)    # client-supplied UUID
    status_code   = models.PositiveSmallIntegerField(null=True)
    response_body = models.TextField(db_collation='Cyrillic_General_CI_AS', null=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'endpoint', 'key'],
                name='uq_idempotency_user_endpoint_key',
            ),
        ]
```

Placement: `core`. It is consumed by `export`, `contracts` and `finance`, and `core` is upstream
of all three, so the dependency direction holds. `core/models/` is already a package —
`__init__.py` must re-export `IdempotencyKey` or the migration is silently skipped.

`endpoint = request.path` rather than a hand-written scope string: nothing to keep in sync, and
for detail actions the path already carries the pk (`/export/shipments/12/comment/`), so two
different shipments cannot collide on one key.

`status_code IS NULL` means **in flight**, not "no response".

`response_body` is `TextField` with `db_collation='Cyrillic_General_CI_AS'` — comment bodies
carry Turkmen and Russian text, and the MSSQL rules require an explicit collation on such fields.

### 2. Decorator — `apps/core/idempotency.py`

```python
@idempotent
def create(self, request, *args, **kwargs): ...
```

A decorator rather than a viewset mixin, because half the targets are `@action` methods that a
`create()`-wrapping mixin would never reach. Both shapes are
`(self, request, *args, **kwargs) -> Response`, so one decorator covers all eight.

Flow:

1. **No `Idempotency-Key` header** → call through unchanged. Backwards compatible: open browser
   tabs and the future mobile CRM keep working.
2. **Header present** → validate against `[A-Za-z0-9\-]{8,64}`; reject with 400 otherwise, so a
   junk or oversized header never reaches the database.
3. **`INSERT` the key first, inside its own `transaction.atomic()`, then call the view.** The
   insert is what resolves the race — a `filter().exists()` check loses when two requests start
   before either commits. `ATOMIC_REQUESTS` is off in this project (noted in
   `views_finance.py:174`), so transactions are explicit.
   - `IntegrityError` → the row exists:
     - `status_code` populated → **return the stored response verbatim**, same status and body.
     - `status_code` NULL → the first request is still running → `409 {"error": "idempotency_in_progress"}`.
   - Insert succeeded → run the view. The outcome splits three ways:
     - **2xx** → persist `status_code` + body, return the response.
     - **Validation 400 / 403** (the view rejected the request before writing anything) →
       **delete the key row**, then return normally. Otherwise an operator who got a 400 on a
       malformed form would fix it, resubmit under the same key, and receive nothing.
     - **5xx or an unhandled exception** → **keep the key row** and record the failure status.
       `ATOMIC_REQUESTS` is off and several of these views write across multiple models before
       they can fail (`views.py:1746` calls `_create_draft_shipment()` / `create_shipment()`;
       `views_finance.py:148` writes the advance row and then its shipment links). A view can
       therefore leave a partial write behind and *then* blow up. Freeing the key would let a
       blind retry re-run that half-finished create. Keeping it makes the replay report the same
       failure, so recovery is a deliberate act — a fresh key — rather than an accidental one.

A replay returns the original 201 and not a 409 because the axios response interceptor
(`api.ts:59`) special-cases 409 only for `season_closed`; any other 409 falls through to a generic
failure toast, and the operator would see "failed" on a request that in fact succeeded.

Storage is a table and **not** Django's cache: `settings.py:251` falls back to `LocMemCache` when
`RUNNING_TESTS or (DEBUG and not REDIS_URL)`, and beta runs with `DEBUG=True`. A cache-backed
store would silently no-op in every test and on the one server where this gets exercised.

### 3. Wiring — 6 call sites

| # | File | Change |
|---|------|--------|
| 1 | `views.py:1746` `ShipmentViewSet.create` | decorate the existing override |
| 2 | `views.py:2566` `comment` action | decorate under `@action` |
| 3 | `views.py:3416` `CommentViewSet` | only `perform_create` exists (`:3540`), no `create()` — add a thin one calling `super().create()` |
| 4 | `views_finance.py:148` advances | decorate the existing override |
| 5 | `views_finance.py:428` customs-expenses | decorate the existing override |
| 6 | `contracts/views.py:69` `ContractViewSet` | no `create()` override exists — add a thin one calling `super().create()` |

For `@action` methods `@action` stays outermost and `@idempotent` sits beneath it, with
`functools.wraps`, or DRF loses the routing attributes it sets on the function.

### 4. Retention

A daily Celery beat task deleting rows older than 24 hours. Beat is already configured
(`settings.py:447`, `poll-traccar-positions`), so this is a schedule entry plus a small task —
not new infrastructure.

### 5. Frontend

```ts
// hooks/useIdempotencyKey.ts
export function useIdempotencyKey(): { key: string; reset: () => void } {
  const ref = useRef<string>(newKey());
  return { key: ref.current, reset: () => { ref.current = newKey(); } };
}
```

```ts
const idem = useIdempotencyKey();
useMutation({
  mutationFn: (p) => api.post('/export/shipments/', p,
                              { headers: { 'Idempotency-Key': idem.key } }),
  onSuccess: () => { idem.reset(); /* ... */ },
});
```

`useRef` is what makes this work: the key survives re-renders, so the second press after a
timeout carries the same key. It is regenerated only after a success, so the next form gets a
fresh one. If the key were generated inside the axios request interceptor instead, every attempt
would mint a new UUID and the mechanism would dedupe nothing.

**One `useIdempotencyKey()` instance per mutation — never shared between mutations, not even
inside one hook file.** `useDrafts.ts` fires `POST /export/shipments/` from four distinct
mutations (`:86`, `:234`, `:285`, `:327`). They share a user and a path, so the uniqueness tuple
`(user, endpoint, key)` is discriminated by the key alone. Hoist one key ref to hook or module
scope across those four and two genuinely different draft creates collide: the second silently
receives the first one's response body and its own draft is never created. This is the single
most dangerous way to get this feature wrong, and it fails silently.

**`crypto.randomUUID()` is secure-context only.** Beta serves over plain HTTP at
`http://10.10.11.25:8080`, where it is `undefined` — idempotency would be dead precisely on the
server where it gets tested. `newKey()` therefore falls back to `crypto.getRandomValues()`.

The response interceptor (`api.ts:59`) gains a branch for 409 `idempotency_in_progress`, showing
a "request already being processed" toast, following the existing `season_closed` pattern. One
i18n key in each of `tk` / `ru` / `en`.

**Frontend call sites — 11 for 6 endpoints.** `POST /export/shipments/` alone accounts for six:

| Endpoint | Call sites |
|----------|-----------|
| `POST /export/shipments/` | `ShipmentCreateModal.tsx:72`, `useSheetCreate.ts:23`, `useDrafts.ts:86`, `:234`, `:285`, `:327` |
| `POST /export/comments/` | `useComments.ts:84` |
| `POST /export/shipments/{id}/comment/` | `CommentComposer.tsx:26` |
| `POST /contracts/` | `useContracts.ts:79` |
| `POST /export/advances/` | `useAdvances.ts:123` (`useCreateAdvance`) |
| `POST` customs-expenses | `useCustomsExpenses.ts:74` |

`SheetCellEditor.tsx:155` and `useApplyUndo.ts:127` reach block-sources and firm-splits through a
dynamic `${endpoint}` segment. Since those two endpoints are already idempotent, both call sites
are left untouched.

### 6. Tests

**Backend mechanism** — `apps/core/tests_idempotency.py`:

| # | Case | Expectation |
|---|------|-------------|
| 1 | No header | unchanged behaviour, no key row written |
| 2 | Same key twice | second returns the stored 201 body; `Shipment.objects.count() == 1` |
| 3 | Key row exists with `status_code IS NULL` | 409 `idempotency_in_progress` |
| 4 | View returns a validation 400 | key row deleted; retry under the same key creates |
| 5 | View raises / returns 5xx | key row **kept** with the failure status; replay returns the same failure, no second create |
| 6 | Same key, different endpoint | both create |
| 7 | Same key, different user | both create |
| 8 | Malformed key | 400 |
| 9 | **True concurrency** — `TransactionTestCase` + two threads | exactly one row created |

Case 9 is required *in addition to* case 2. A sequential retry passes even against a
`filter().exists()` implementation, so it cannot catch the race; only the parallel test can.

Plus one smoke test per endpoint (6), asserting the replay returns the stored response and no
second row appears.

**Frontend** — `useIdempotencyKey.test.ts`: the key is stable across re-renders and changes after
`reset()`. Then two form-level tests, and the second is the one that matters:

1. Two consecutive submits of **the same** mutation send the **same** header value.
2. Two **different** draft mutations from `useDrafts.ts` send **different** header values.

Test 1 alone passes even against a key hoisted to module scope — the failure mode described in
§5. Only test 2 catches it.

### 7. Documentation

`CHANGELOG.md`, `BUILD_TEST_LOG.md`, and per project rule `docs/obsidian/` — a new page under
`reference/` plus a note in `reference/api-endpoint-map.md`.

---

## Out of scope

- Backfill or detection of pre-existing duplicates (decision: preventive only).
- The ~60 action endpoints.
- Idempotency for `PUT`/`PATCH`/`DELETE` — already idempotent by method semantics.
- Making the eight endpoints *require* the header. It stays optional so existing clients and the
  future mobile CRM are never broken by its absence.
