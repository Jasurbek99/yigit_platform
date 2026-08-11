# API Idempotency

How to retry a `POST` create without producing a duplicate.

Related: [[api-endpoint-map]] · [[../../ADR|ADR]]

---

## Why this exists

The frontend already blocks the trivial double-click (`disabled`/`loading={isPending}` appears in
80 places across 54 files). The failure this feature addresses is different: an operator on a
public network in KZ/RU presses Save, the request **reaches the server and succeeds**, the response
is lost, and the operator presses Save again 30–60 seconds later. `services/api.ts` sets no axios
`timeout`, so that window is wide.

Before this existed, a retry on `POST /export/shipments/` minted a **second shipment code** and a
retry on `POST /contracts/contracts/` minted a **second contract number** — the unique constraints
on those columns never fired, because the server generates a fresh value each time.

## The contract

Send an `Idempotency-Key` header on the create request.

| | |
|---|---|
| Header | `Idempotency-Key` |
| Format | `[A-Za-z0-9\-]{8,64}` — anything else is `400 {"error": "invalid_idempotency_key"}` |
| Uniqueness | scoped to `(user, request.path, key)` — the same key on a different endpoint or from a different user does not collide |
| Optional | **Absent header = old behaviour, unchanged.** Existing clients and the future mobile CRM are never broken by omitting it |
| Retention | 24 hours, purged by a daily Celery beat task |

### Outcomes

| The view returned | What is stored | What a retry under the same key gets |
|---|---|---|
| **2xx** | status + response body | the **original** response, replayed verbatim |
| **400 / 403** (validation — nothing was written) | nothing; the key row is deleted | the key is free again, so a corrected resubmit creates normally |
| **5xx or an unhandled exception** | the failure status | the same failure — **not** a re-run |
| still running | — | `409 {"error": "idempotency_in_progress"}` |

The 5xx case is deliberate. `ATOMIC_REQUESTS` is off in this project and several of these views
write across multiple models before they can fail (`ShipmentViewSet.create` calls
`_create_draft_shipment()` / `create_shipment()`; the advances `create` writes the advance row and
then its shipment links). A view can leave a partial write behind and *then* blow up, so freeing
the key would let a blind retry re-run a half-finished create. Recovery is a deliberate act — a
fresh key — rather than an accidental one.

A replay returns the original **201, not a 409**, because the axios response interceptor
special-cases 409 only for `season_closed` and `idempotency_in_progress`; any other 409 falls
through to a generic failure toast, and the operator would see "failed" on a request that in fact
succeeded.

## Covered endpoints

| Endpoint | View |
|---|---|
| `POST /export/shipments/` | `views.py` — `ShipmentViewSet.create` |
| `POST /export/shipments/{id}/comment/` | `views.py` — `comment` action (legacy path) |
| `POST /export/comments/` | `views.py` — `CommentViewSet.create` |
| `POST /export/advances/` | `views_finance.py` — `FinansistAdvanceViewSet.create` |
| `POST /export/customs-expenses/` | `views_finance.py` — `CustomsExpenseViewSet.create` |
| `POST /contracts/contracts/` | `contracts/views.py` — `ContractViewSet.create` |

### Deliberately NOT covered

- `POST /export/shipments/{id}/block-sources/` and `POST /export/shipments/{id}/firm-splits/` —
  **already idempotent.** Both are *replace* operations: `block-sources` calls
  `write_block_sources(..., replace=True)` which deletes existing rows first, and `firm-splits`
  runs `shipment.firm_splits.all().delete()` before inserting. A retry replaces the same set with
  itself. The `unique_together` constraints on those models are never reached.
- The ~60 action endpoints (`transition`, `approve`, `reject`, `done`, `reopen`, `restore`,
  `soft-delete`, `bulk-*`). A repeat is a no-op or already idempotent.
- `PUT` / `PATCH` / `DELETE` — idempotent by method semantics.

## Backend

`apps/core/models/idempotency.py` — `IdempotencyKey`:

```
user, endpoint, key            # UniqueConstraint uq_idempotency_user_endpoint_key
status_code, response_body     # NULL status_code == in flight
created_at
```

`response_body` is `TextField(db_collation='Cyrillic_General_CI_AS')` — comment bodies carry
Turkmen and Russian text.

`apps/core/idempotency.py` — the `@idempotent` decorator. A decorator rather than a viewset mixin
because two of the targets are `@action` methods a `create()`-wrapping mixin would never reach.
For `@action` methods, `@action` stays outermost:

```python
@action(detail=True, methods=['post'], url_path='comment')
@idempotent
def comment(self, request, pk=None): ...
```

**The INSERT comes before the view runs, inside its own `transaction.atomic()`.** That is the
whole mechanism: two concurrent retries race on the unique constraint and exactly one wins. A
`filter().exists()` check would let both through — this is pinned by
`apps/core/tests/test_idempotency_concurrency.py`, which fails against a check-then-create
implementation.

**Storage is a table, not Django's cache.** `settings.py` falls back to `LocMemCache` when
`RUNNING_TESTS or (DEBUG and not REDIS_URL)`, and beta runs with `DEBUG=True` — a cache-backed
store would silently no-op in every test and on the one server where this gets exercised.

## Frontend

`hooks/useIdempotencyKey.ts`:

```ts
const idem = useIdempotencyKey();
useMutation({
  mutationFn: (p) => api.post('/export/shipments/', p,
                              { headers: { [IDEMPOTENCY_HEADER]: idem.key } }),
  onSuccess: () => { idem.reset(); /* ... */ },
});
```

`useRef` is what makes this work: the key survives re-renders, so the second press after a timeout
carries the same key. It is regenerated only after success. **Generating the key inside the axios
request interceptor would dedupe nothing** — every attempt would mint a new UUID.

> [!warning] One `useIdempotencyKey()` per mutation
> Never share an instance between two mutations, not even inside one hook file. `useDrafts.ts`
> fires `POST /export/shipments/` from four distinct mutations; they share a user and a path, so
> the key is the only thing distinguishing them. Hoist one key to hook or module scope and two
> genuinely different draft creates collide — the second silently receives the first one's
> response and its own draft is never created. Pinned by
> `useDrafts.idempotency.test.tsx`, whose second test asserts two different draft mutations send
> **different** keys.

`crypto.randomUUID()` is **secure-context only**. Beta serves over plain HTTP at
`http://10.10.11.25:8080`, where it is `undefined`, so `newKey()` falls back to
`crypto.getRandomValues()`. Without that fallback idempotency would be dead precisely on the
server where it gets tested.

### Call sites

| Endpoint | Frontend |
|---|---|
| `POST /export/shipments/` | `ShipmentCreateModal.tsx`, `useSheetCreate.ts`, and four mutations in `useDrafts.ts` (`useCreateDraft`, `useCreateSupplyDraft`, `useCreateEmptyColumn`, `useCreateDestinationDraft`) |
| `POST /export/comments/` | `useComments.ts` — `useCreateComment` |
| `POST /export/shipments/{id}/comment/` | `CommentComposer.tsx` |
| `POST /contracts/contracts/` | `useContracts.ts` — `useCreateContract` |
| `POST /export/advances/` | `useAdvances.ts` — `useCreateAdvance` |
| `POST /export/customs-expenses/` | `useCustomsExpenses.ts` — `useCreateCustomsExpense` |

## Retention

`apps/core/tasks.py` — `purge_expired_idempotency_keys()`, registered in `CELERY_BEAT_SCHEDULE`
as `purge-expired-idempotency-keys` on a 24-hour schedule. Requires a running Celery worker **and**
beat; without them the table grows unbounded (one row per create request carrying the header).

## Tests

| File | Covers |
|---|---|
| `apps/core/tests/test_idempotency.py` | the unique constraint directly (4) |
| `apps/core/tests/test_idempotency_decorator.py` | no header, replay, in-flight 409, 400 frees, 5xx keeps, malformed key (6) |
| `apps/core/tests/test_idempotency_concurrency.py` | two simultaneous requests execute the view once (1) |
| `apps/core/tests/test_idempotency_cleanup.py` | the 24h purge (2) |
| `apps/export/tests_idempotency_endpoints.py` | shipments, both comment paths, advances, expenses (7) |
| `apps/contracts/tests/test_idempotency.py` | contracts (1) |
| `frontend/src/hooks/useIdempotencyKey.test.ts` | stability, reset, per-instance, plain-HTTP fallback (5) |
| `frontend/src/hooks/useDrafts.idempotency.test.tsx` | same-mutation reuse, different-mutation separation (2) |
| `frontend/src/services/api.idempotency.test.ts` | the three 409 interceptor branches (3) |
