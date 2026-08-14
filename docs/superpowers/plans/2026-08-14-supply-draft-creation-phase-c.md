# Supply Draft Creation (Phase C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Create supply draft" modal (launched from the Shipment List) that creates a `status='draft'` shipment carrying a declared total weight, blocks **without** per-block weights, variety, harvest status, notes and export code — the loading-side half of a shipment, to be joined with a destination half later.

**Architecture:** `ShipmentBlockSource.weight_kg` becomes nullable so blocks can be stored before they're weighed. The declared total goes in `weight_net`. The existing `POST /export/shipments/` draft branch is extended with a `block_ids` (no-weight) input. The join's `weight_net` recompute is fixed to fall back to the supply draft's declared total when block weights are incomplete. Frontend adds a modal reusing existing self-fetching controls.

**Tech Stack:** Django 5 + DRF (MSSQL), React 18 + TypeScript + Ant Design, TanStack Query, vitest + @testing-library/react, Django `TestCase`.

**Spec:** [`docs/superpowers/specs/2026-08-14-supply-draft-creation-design.md`](../specs/2026-08-14-supply-draft-creation-design.md)

## Global Constraints

- **MSSQL**: no `JSONField`/`ArrayField`/`DISTINCT ON`; every `bulk_create`/`bulk_update` needs `batch_size=500`. Making `weight_kg` nullable is a column-nullability change (no data migration).
- **Backend tests run against a real MSSQL test DB** (`test_YIGIT_PLATFROM`) whenever `DJANGO_TESTING=true` or `'test' in sys.argv` (`backend/config/settings.py:162-175`) — so the nullability migration IS exercised by the suite. Always run backend tests as `cd backend && DJANGO_TESTING=true python manage.py test <module> -v 2`.
- **The backend suite has ~71 pre-existing unrelated failures.** Run only the module you touch; do not fix unrelated failures.
- **Test fixtures need required fields:** `Season` requires `start_date`/`end_date`; `Shipment` requires `date`. Use the `_make_*` helpers in `tests_shipment_join.py` as the pattern.
- **No Django signals. No reverse imports** (`core ← greenhouse ← export`). No business logic in views beyond delegating to services/serializers.
- **i18n strict**: every user-visible string in all three of `frontend/src/i18n/{tk,ru,en}.json`, same commit, each file its own language. New namespace `supply_draft.*`.
- **TypeScript strict**: no `any`, no `as` unless unavoidable, `I`-prefixed interfaces. Typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` from `frontend/` (`npm run type-check` is broken — TS5103). Tests: `npx vitest run` from `frontend/`.
- **Max 150 lines per React component, 200 per Python file.**
- **Co-author trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **One commit per task.** Do not commit unrelated working-tree changes (there is pre-existing uncommitted contracts/document work — stage only the files each task touches).

### Correction to the spec (found during interface research)
Spec §3.1 point 1 said the join should "keep the declared `weight_net`" on the target. But the declared total lives on the **source** (supply draft), which `_execute_join` hard-deletes. The correct fix (Task 5) is: capture `source.weight_net` before delete, and when the moved blocks have **any** null weight, set the target's `weight_net` to that captured total instead of the (incomplete) `Sum`. This plan implements that; the spec's intent is preserved, the mechanism is corrected.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `backend/apps/export/models/shipment.py:416` | `weight_kg` → nullable | Modify |
| `backend/apps/export/migrations/00XX_blocksource_weight_nullable.py` | The nullability migration | Create (via makemigrations) |
| `backend/apps/export/management/commands/normalize_block_sources.py` | Null-guard so it skips null-weight rows | Modify |
| `backend/apps/export/serializers.py` (`ShipmentCreateSerializer` ~1582) | Add `weight_net`, `block_ids`, `harvest_status` | Modify |
| `backend/apps/export/views.py` (`_create_draft_shipment` ~1843) | `block_ids` no-weight branch; persist new fields | Modify |
| `backend/apps/export/views.py` (`_execute_join` ~2220) | weight_net fallback to source declared total | Modify |
| `backend/apps/export/tests_supply_draft.py` | New backend tests | Create |
| `frontend/src/types/index.ts` | `weight_kg: number \| null` ×3; widen draft-create payload type | Modify |
| `frontend/src/pages/export/SalesReportPage.tsx:219` | Guard the block-weight reduce against null | Modify |
| `frontend/src/components/BlockSelect.tsx` | Add multi-select variant | Modify |
| `frontend/src/hooks/useDrafts.ts` (`useCreateSupplyDraft` ~213) | Update payload/mock for no-weight `block_ids` | Modify |
| `frontend/src/components/shipment/SupplyDraftModal.tsx` | The modal | Create |
| `frontend/src/components/shipment/SupplyDraftModal.test.tsx` | Modal test | Create |
| `frontend/src/pages/export/ShipmentList.tsx:732` | "Create supply draft" button | Modify |
| `frontend/src/i18n/{tk,ru,en}.json` | `supply_draft.*` keys | Modify |
| `docs/obsidian/processes/draft-shipments.md` | Finding #3 update + subsection | Modify |
| `CHANGELOG.md`, `BUILD_TEST_LOG.md` | Changelog + build log | Modify |

---

## Task 1: Make `ShipmentBlockSource.weight_kg` nullable

**Files:**
- Modify: `backend/apps/export/models/shipment.py:416`
- Create: migration
- Test: `backend/apps/export/tests_supply_draft.py`

**Interfaces:**
- Produces: a `ShipmentBlockSource` whose `weight_kg` may be `None`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_supply_draft.py`:
```python
"""Tests for Phase C — supply draft creation (nullable block weights)."""
from decimal import Decimal

from django.test import TestCase

from apps.core.models import GreenhouseBlock, Season, ShipmentStatusType
from apps.export.models import Shipment, ShipmentBlockSource


class BlockSourceNullableWeightTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block = GreenhouseBlock.objects.create(code='JA', name='JA')
        cls.shipment = Shipment.objects.create(
            shipment_code='0101001/26', status=cls.draft, season=cls.season,
            date='2026-01-01',
        )

    def test_block_source_allows_null_weight(self):
        bs = ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=None,
        )
        bs.refresh_from_db()
        self.assertIsNone(bs.weight_kg)
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft -v 2
```
Expected: FAIL — `IntegrityError` (NULL into non-nullable `weight_kg`).

- [ ] **Step 3: Make the field nullable**

`backend/apps/export/models/shipment.py:416`:
```python
weight_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend && DJANGO_TESTING=true python manage.py makemigrations export
```
Rename the generated file to something descriptive if needed. Verify it only alters `weight_kg` nullability (no unexpected changes).

- [ ] **Step 5: Run the test — expect pass**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft -v 2
```
Expected: PASS.

- [ ] **Step 6: Confirm no other pending migrations**

```bash
cd backend && DJANGO_TESTING=true python manage.py makemigrations --check --dry-run
```
Expected: `No changes detected`.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/export/models/shipment.py backend/apps/export/migrations/ backend/apps/export/tests_supply_draft.py
git commit -m "feat(p3): make ShipmentBlockSource.weight_kg nullable

Blocks can be recorded before they are weighed (supply drafts). Weight is
filled in later; null is an honest 'not weighed yet'.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Null-guard `normalize_block_sources`

**Files:**
- Modify: `backend/apps/export/management/commands/normalize_block_sources.py:56-70`
- Test: `backend/apps/export/tests_supply_draft.py` (append)

**Why:** the command re-reads existing `bs.weight_kg` into `entries` and passes them to `merge_to_parent`, which does `Decimal(str(entry['weight_kg']))` — `Decimal(str(None))` raises `InvalidOperation`. Once weights can be null, this command crashes on any shipment that has a null-weight parent block. Guard: skip null-weight rows (they aren't measured yet, so there's nothing to normalize).

**Interfaces:**
- Consumes: `ShipmentBlockSource` rows that may have `weight_kg=None` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `tests_supply_draft.py`:
```python
from io import StringIO
from django.core.management import call_command


class NormalizeBlockSourcesNullTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block = GreenhouseBlock.objects.create(code='JB', name='JB')
        cls.shipment = Shipment.objects.create(
            shipment_code='0101002/26', status=cls.draft, season=cls.season,
            date='2026-01-01',
        )
        ShipmentBlockSource.objects.create(
            shipment=cls.shipment, block=cls.block, weight_kg=None,
        )

    def test_normalize_skips_null_weight_rows(self):
        out = StringIO()
        # Must not raise decimal.InvalidOperation.
        call_command('normalize_block_sources', stdout=out)
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.NormalizeBlockSourcesNullTests -v 2
```
Expected: FAIL — `decimal.InvalidOperation`.

- [ ] **Step 3: Add the null-guard**

In `normalize_block_sources.py`, where it builds `entries` from existing rows (~line 56-64), skip rows whose `weight_kg is None`:
```python
# A null weight means the block was recorded but not yet weighed (supply
# draft). There is nothing to normalize; skip it.
if bs.weight_kg is None:
    continue
```
Place this at the top of the per-row loop that reads `bs.weight_kg`.

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.NormalizeBlockSourcesNullTests -v 2
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/management/commands/normalize_block_sources.py backend/apps/export/tests_supply_draft.py
git commit -m "fix(p3): skip null-weight rows in normalize_block_sources

Now that weight_kg can be null (unweighed supply blocks), the command's
Decimal(str(weight)) normalization would crash on None.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Serializer — accept `weight_net`, `block_ids`, `harvest_status`

**Files:**
- Modify: `backend/apps/export/serializers.py` (`ShipmentCreateSerializer` ~1582)
- Test: `backend/apps/export/tests_supply_draft.py` (append)

**Interfaces:**
- Produces: `ShipmentCreateSerializer` validated data may contain `weight_net: Decimal`, `block_ids: list[GreenhouseBlock]`, `harvest_status: str`.

**Notes:** `block_ids` is a **separate** field from the existing weighted `block_sources` (which requires `weight_kg ≥ 0.01`). Variety continues to flow through the existing `varieties` list field (the modal will send `varieties=[id]`), so no `variety` change is needed here.

- [ ] **Step 1: Write the failing test**

Append to `tests_supply_draft.py`:
```python
from apps.export.serializers import ShipmentCreateSerializer


class SupplySerializerFieldTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.block = GreenhouseBlock.objects.create(code='JC', name='JC')

    def test_accepts_block_ids_weight_net_harvest_status(self):
        ser = ShipmentCreateSerializer(data={
            'is_draft': True,
            'skip_forecast_check': True,
            'weight_net': '22000.00',
            'block_ids': [self.block.pk],
            'harvest_status': 'ok',
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['weight_net'], Decimal('22000.00'))
        self.assertEqual(ser.validated_data['harvest_status'], 'ok')
        self.assertEqual(list(ser.validated_data['block_ids']), [self.block])
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.SupplySerializerFieldTests -v 2
```
Expected: FAIL — unknown fields ignored, `validated_data` lacks the keys.

- [ ] **Step 3: Add the fields to `ShipmentCreateSerializer`**

In `serializers.py`, inside `ShipmentCreateSerializer` (near the other explicit fields, ~1582-1620):
```python
weight_net = serializers.DecimalField(
    max_digits=10, decimal_places=2, min_value=Decimal('0'),
    required=False, allow_null=True,
)
block_ids = serializers.PrimaryKeyRelatedField(
    many=True, queryset=GreenhouseBlock.objects.all(), required=False,
)
harvest_status = serializers.CharField(
    max_length=20, required=False, allow_blank=True, allow_null=True,
)
```
Ensure `GreenhouseBlock` and `Decimal` are imported at the top of the file (they already are — `BlockSourceInputSerializer` uses both).

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.SupplySerializerFieldTests -v 2
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/serializers.py backend/apps/export/tests_supply_draft.py
git commit -m "feat(p3): ShipmentCreateSerializer accepts block_ids, weight_net, harvest_status

block_ids is a no-weight block list for supply drafts, distinct from the
weighted block_sources the forecast composer sends.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `_create_draft_shipment` — the `block_ids` supply branch

**Files:**
- Modify: `backend/apps/export/views.py` (`_create_draft_shipment` ~1843-1976)
- Test: `backend/apps/export/tests_supply_draft.py` (append)

**Interfaces:**
- Consumes: serializer fields from Task 3; `_apply_draft_varieties(shipment, varieties)` (views.py:1818).
- Produces: `POST /export/shipments/` with `is_draft:true, block_ids:[...], weight_net, varieties:[id], harvest_status` creates a draft whose block_sources have `weight_kg=None`, with `weight_net`, `variety`+`varieties_dominant`, and `harvest_status` set.

**Critical:** the `block_ids` path must **not** go through `write_block_sources` (its `merge_to_parent` crashes on null weight). Use a direct `bulk_create(batch_size=500)` of `ShipmentBlockSource(shipment=..., block_id=..., weight_kg=None)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests_supply_draft.py`:
```python
from rest_framework.test import APIClient
from apps.core.models import TomatoVariety, User


class SupplyDraftCreateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.block_a = GreenhouseBlock.objects.create(code='JD', name='JD')
        cls.block_b = GreenhouseBlock.objects.create(code='JE', name='JE')
        cls.variety = TomatoVariety.objects.create(name='Pink', code='PK')
        cls.loader = User.objects.create_user(
            username='solt', password='pw', role='loading_dept_head',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.loader)

    def _payload(self, **over):
        base = {
            'is_draft': True,
            'skip_forecast_check': True,
            'weight_net': '22000.00',
            'block_ids': [self.block_a.pk, self.block_b.pk],
            'varieties': [self.variety.pk],
            'harvest_status': 'ok',
        }
        base.update(over)
        return base

    def test_creates_supply_draft_with_null_weight_blocks(self):
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        s = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(s.status.code, 'draft')
        self.assertEqual(s.weight_net, Decimal('22000.00'))
        self.assertEqual(s.harvest_status, 'ok')
        self.assertEqual(s.variety_id, self.variety.pk)
        self.assertEqual(set(s.varieties_dominant.values_list('pk', flat=True)), {self.variety.pk})
        self.assertEqual(s.block_sources.count(), 2)
        self.assertTrue(all(bs.weight_kg is None for bs in s.block_sources.all()))

    def test_skip_forecast_check_bypasses_truck_cap(self):
        # 22,000 kg total exceeds the 18,500 one-truck cap; supply drafts skip it.
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_role_gate_blocks_disallowed_role(self):
        sales = User.objects.create_user(username='srep', password='pw', role='sales_rep')
        self.client.force_authenticate(user=sales)
        resp = self.client.post('/api/v1/export/shipments/', self._payload(), format='json')
        self.assertEqual(resp.status_code, 403, resp.data)
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.SupplyDraftCreateTests -v 2
```
Expected: FAIL — `block_ids` ignored, no block_sources created / weight_net unset.

- [ ] **Step 3: Implement the branch**

In `_create_draft_shipment` (views.py ~1843-1976):
- When creating the `Shipment`, include `weight_net=data.get('weight_net')` and `harvest_status=data.get('harvest_status') or ''` in the `Shipment.objects.create(...)` kwargs (alongside the existing `variety=data.get('variety')`).
- After the shipment is created and after the existing `varieties`/`_apply_draft_varieties` handling, add the no-weight block branch:
```python
block_ids = data.get('block_ids') or []
if block_ids:
    ShipmentBlockSource.objects.bulk_create(
        [
            ShipmentBlockSource(shipment=shipment, block=block, weight_kg=None)
            for block in block_ids
        ],
        batch_size=500,
    )
```
Ensure `ShipmentBlockSource` is imported in views.py (it is — used elsewhere in the file). `block_ids` arrives as a list of `GreenhouseBlock` instances (PrimaryKeyRelatedField), so use `block=block`.
- Leave the existing weighted `block_sources` → `write_block_sources` path untouched (the forecast composer still uses it). `block_ids` and `block_sources` are mutually exclusive in practice; if both are somehow sent, process both — they can't collide because `unique_together=(shipment, block)` and the composer/modal never mix them.

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.SupplyDraftCreateTests -v 2
```
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/views.py backend/apps/export/tests_supply_draft.py
git commit -m "feat(p3): create supply drafts with no-weight blocks + total weight

_create_draft_shipment gains a block_ids branch: bulk_creates block_sources
with weight_kg=None (bypassing write_block_sources, which requires weights),
and persists weight_net + harvest_status. Variety flows via the existing
varieties list.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Join preserves the declared total when weights are incomplete

**Files:**
- Modify: `backend/apps/export/views.py` (`_execute_join` ~2220-2222)
- Test: `backend/apps/export/tests_supply_draft.py` (append)

**Why (corrected from spec):** the declared total sits on the **source** (supply) shipment, which is hard-deleted. Today `_execute_join` sets `target.weight_net = Sum(block_sources.weight_kg) or 0`. If the moved blocks are unweighed (null), that becomes 0 (or an understated partial sum). Fix: capture `source.weight_net` before deletion; if the target's moved blocks have any null weight, use the captured declared total instead of the sum.

**Interfaces:**
- Consumes: a source (supply) shipment with `weight_net` set and null-weight block_sources (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `tests_supply_draft.py` (mirror the existing `JoinSuccessTests` fixture in `tests_shipment_join.py` for the destination target + privileged user):
```python
class JoinNullWeightTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', is_active=True,
            start_date='2025-09-01', end_date='2026-06-30',
        )
        cls.draft = ShipmentStatusType.objects.create(
            code='draft', name_tk='Garalama', step_order=0,
        )
        cls.country = __import__('apps.core.models', fromlist=['Country']).Country.objects.create(name_en='KZ')
        cls.customer = __import__('apps.core.models', fromlist=['Customer']).Customer.objects.create(name='Begjan')
        cls.block_a = GreenhouseBlock.objects.create(code='JF', name='JF')
        cls.block_b = GreenhouseBlock.objects.create(code='JG', name='JG')
        cls.mgr = User.objects.create_user(username='gadam', password='pw', role='export_manager')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.mgr)

    def _supply(self, weights):
        s = Shipment.objects.create(
            shipment_code='0201001/26', status=self.draft, season=self.season,
            date='2026-01-01', weight_net=Decimal('22000.00'),
        )
        blocks = [self.block_a, self.block_b]
        ShipmentBlockSource.objects.bulk_create(
            [ShipmentBlockSource(shipment=s, block=b, weight_kg=w) for b, w in zip(blocks, weights)],
            batch_size=500,
        )
        return s

    def _dest(self):
        return Shipment.objects.create(
            shipment_code='0201002/26', status=self.draft, season=self.season,
            date='2026-01-01', country=self.country, customer=self.customer,
        )

    def test_all_null_blocks_use_source_declared_total(self):
        supply = self._supply([None, None])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('22000.00'))

    def test_mixed_null_blocks_use_source_declared_total(self):
        supply = self._supply([Decimal('5000.00'), None])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('22000.00'))

    def test_all_weighted_blocks_recompute_from_sum(self):
        supply = self._supply([Decimal('9000.00'), Decimal('9500.00')])
        dest = self._dest()
        resp = self.client.post(f'/api/v1/export/shipments/{dest.pk}/join/',
                                {'source_id': supply.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        dest.refresh_from_db()
        self.assertEqual(dest.weight_net, Decimal('18500.00'))
```
(If the real `Country`/`Customer` constructors differ, copy the exact `_make_country`/`_make_customer` helpers from `tests_shipment_join.py` instead of the `__import__` shorthand.)

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.JoinNullWeightTests -v 2
```
Expected: FAIL — the two null cases get `weight_net = 0` (or partial 5000), not 22000.

- [ ] **Step 3: Fix the recompute in `_execute_join`**

Before `source.delete()`, capture the declared total. At the weight_net recompute (~views.py:2220-2222), replace:
```python
agg = target.block_sources.aggregate(total=Sum('weight_kg'))
update_fields['weight_net'] = agg['total'] or Decimal('0')
```
with:
```python
# If any moved block is still unweighed (supply draft not yet detailed),
# the block Sum understates the truck — fall back to the supply draft's
# declared total (source.weight_net), captured before the source is deleted.
has_null_weight = target.block_sources.filter(weight_kg__isnull=True).exists()
if has_null_weight and source_weight_net is not None:
    update_fields['weight_net'] = source_weight_net
else:
    agg = target.block_sources.aggregate(total=Sum('weight_kg'))
    update_fields['weight_net'] = agg['total'] or Decimal('0')
```
Add `source_weight_net = source.weight_net` near the top of `_execute_join`, before the block-move/delete (alongside where it already reads source fields like variety/export_code, ~2205-2218). Confirm `Sum` is imported (it is).

- [ ] **Step 4: Run — expect pass (and no regression)**

```bash
cd backend && DJANGO_TESTING=true python manage.py test apps.export.tests_supply_draft.JoinNullWeightTests apps.export.tests_shipment_join.JoinSuccessTests -v 2
```
Expected: PASS — the 3 new tests + the existing `JoinSuccessTests` (incl. `test_join_recomputes_weight_net`) still green.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/export/views.py backend/apps/export/tests_supply_draft.py
git commit -m "fix(p3): join preserves declared total when supply blocks are unweighed

_execute_join recomputed weight_net from the block Sum, which nulls/understates
it when a joined supply draft's blocks have no weights yet. Capture the source's
declared weight_net before delete and use it when any moved block is unweighed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend types + guard the sales-report reduce

**Files:**
- Modify: `frontend/src/types/index.ts` (lines 318, 676, 1654 + draft-create payload ~1683)
- Modify: `frontend/src/pages/export/SalesReportPage.tsx:219`

**Interfaces:**
- Produces: `weight_kg: number | null` on `IBlockSource`, `ISheetBlockSource`, `IDraftBlockSource`; a draft-create payload type carrying optional `weight_net`, `block_ids`, `harvest_status`, optional `block_sources`.

- [ ] **Step 1: Widen the three block-source interfaces**

In `types/index.ts`, change `weight_kg: number;` to `weight_kg: number | null;` on `IBlockSource` (line 676), `ISheetBlockSource` (line 318), `IDraftBlockSource` (line 1654).

- [ ] **Step 2: Widen the draft-create payload type**

Find `IDraftCreatePayload` (~line 1683). Make `block_sources?` optional and add the supply fields:
```typescript
export interface IDraftCreatePayload {
  shipment_code?: string;
  date?: string;
  is_draft: boolean;
  skip_forecast_check?: boolean;
  block_sources?: { block_id: number; weight_kg: number }[];
  block_ids?: number[];
  weight_net?: number;
  varieties?: number[];
  harvest_status?: string;
  export_code?: string;
  notes?: string;
  // (keep any existing fields already declared)
}
```
Keep every field the type already has; only add/relax. If some of these already exist, don't duplicate.

- [ ] **Step 3: Guard the sales-report reduce**

`SalesReportPage.tsx:219`, change:
```typescript
const blockTotal = (detail.block_sources ?? []).reduce((s, b) => s + b.weight_kg, 0);
```
to:
```typescript
const blockTotal = (detail.block_sources ?? []).reduce((s, b) => s + Number(b.weight_kg ?? 0), 0);
```

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: no errors. (If a consumer now errors on `number | null`, guard it with `?? 0` — `DraftPool.tsx` already does; others only read `.block_code`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/export/SalesReportPage.tsx
git commit -m "fix(p3): block weight is nullable on the frontend; guard sales-report sum

Mirrors the backend nullable weight_kg. Guards SalesReportPage's reduce so a
single unweighed block doesn't poison the sum to NaN.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Extend `BlockSelect` with a multi-select variant

**Files:**
- Modify: `frontend/src/components/BlockSelect.tsx`
- Test: `frontend/src/components/BlockSelect.test.tsx` (create)

**Interfaces:**
- Produces: `<BlockSelect mode="multiple" value={number[]} onChange={(ids: number[]) => void} />`, plus the existing single-select API unchanged. Follow the discriminated-union precedent in `VarietySelect.tsx:8-33`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/BlockSelect.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlockSelect } from './BlockSelect';

vi.mock('@/hooks/useAdmin', () => ({
  useGreenhouseBlocks: () => ({
    data: [{ id: 1, code: 'A', name: 'A' }, { id: 2, code: 'B', name: 'B' }],
    isLoading: false,
  }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BlockSelect multiple', () => {
  it('emits an array of ids when mode=multiple', async () => {
    const onChange = vi.fn();
    wrap(<BlockSelect mode="multiple" value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('A'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });
});
```
(Confirm the real hook name — the research cites `useGreenhouseBlocks` from `@/hooks/useAdmin`; if `BlockSelect` uses a different hook, mock that one.)

- [ ] **Step 2: Run — expect failure**

```bash
cd frontend && npx vitest run src/components/BlockSelect.test.tsx
```
Expected: FAIL — no `mode` prop; single-select emits a number, not an array.

- [ ] **Step 3: Add the multi-select variant**

Rewrite `BlockSelect`'s props as a discriminated union mirroring `VarietySelect.tsx:8-33`:
```typescript
interface IBlockSelectBaseProps {
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  excludeIds?: number[];
  allowedIds?: number[];
}
interface IBlockSelectSingleProps extends IBlockSelectBaseProps {
  mode?: undefined;
  value?: number | null;
  onChange?: (value: number | null) => void;
}
interface IBlockSelectMultipleProps extends IBlockSelectBaseProps {
  mode: 'multiple';
  value?: number[];
  onChange?: (value: number[]) => void;
}
type IBlockSelectProps = IBlockSelectSingleProps | IBlockSelectMultipleProps;
```
Pass `mode` through to the underlying antd `Select`; keep the option-building (`excludeIds`/`allowedIds`) shared. Follow exactly how `VarietySelect` branches its `onChange`.

- [ ] **Step 4: Run — expect pass**

```bash
cd frontend && npx vitest run src/components/BlockSelect.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
git add frontend/src/components/BlockSelect.tsx frontend/src/components/BlockSelect.test.tsx
git commit -m "feat(p3): BlockSelect multi-select variant

Discriminated-union props mirroring VarietySelect; single-select API unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `useCreateSupplyDraft` — no-weight payload

**Files:**
- Modify: `frontend/src/hooks/useDrafts.ts` (`useCreateSupplyDraft` ~213-260)

**Interfaces:**
- Produces: `useCreateSupplyDraft()` → a mutation taking `{ weight_net, block_ids, varieties?, harvest_status?, export_code?, notes? }`, posting `{is_draft:true, skip_forecast_check:true, ...}` with an idempotency header.

- [ ] **Step 1: Update the hook**

Rewrite `useCreateSupplyDraft`'s mutation payload to the new shape (drop the old weighted `block_sources.reduce` mock branch; it referenced `weight_kg` that no longer exists on this path). Post to `/export/shipments/` with `{ is_draft: true, skip_forecast_check: true, weight_net, block_ids, varieties, harvest_status, export_code, notes }` and the `IDEMPOTENCY_HEADER` (reuse the pattern in `ShipmentCreateModal.tsx`). On success, `invalidateQueries({ queryKey: ['shipments'] })` and `['drafts']` if that key is used.

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useDrafts.ts
git commit -m "feat(p3): useCreateSupplyDraft posts the no-weight supply payload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `SupplyDraftModal` component

**Files:**
- Create: `frontend/src/components/shipment/SupplyDraftModal.tsx`
- Create: `frontend/src/components/shipment/SupplyDraftModal.test.tsx`
- Modify: `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Consumes: `useCreateSupplyDraft` (Task 8), `BlockSelect mode="multiple"` (Task 7), `VarietySelect`, `useShipmentOptions('harvest_status')`, `OfficialCodeEditor`, `useIdempotencyKey`.
- Produces: `<SupplyDraftModal open onClose onSuccess />`.

**Fields (spec §5):** Total weight (kg, required → `weight_net`), Blocks (multi, required ≥1 → `block_ids`), Variety (optional → `varieties:[id]`), Harvest status (optional → `harvest_status`), Export code (optional → `export_code`), Notes (optional). ≤150 lines — extract a sub-row if needed.

- [ ] **Step 1: Write the failing test**

Create `SupplyDraftModal.test.tsx` on the `DocumentOptionsModal.test.tsx` harness (QueryClientProvider, i18n en, mock `useGreenhouseBlocks`/`useTomatoVarieties`/`useShipmentOptions` from `@/hooks/useAdmin`, and mock `useCreateSupplyDraft` from `@/hooks/useDrafts` to capture the payload):
```typescript
it('submits weight_net + block_ids and blocks empty-block submit', async () => {
  const mutate = vi.fn();
  // ...mock useCreateSupplyDraft to return { mutate, isPending: false }
  // render <SupplyDraftModal open onClose onSuccess />
  // click submit with no blocks → mutate NOT called (validation)
  // pick a block, enter weight 22000, submit → mutate called with
  //   { weight_net: 22000, block_ids: [<id>], ... }
});
```
Write the concrete assertions using the mock; assert `mutate` is called with `block_ids` non-empty and `weight_net` numeric, and NOT called when blocks are empty.

- [ ] **Step 2: Run — expect failure** (`vitest run src/components/shipment/SupplyDraftModal.test.tsx`) — module doesn't exist.

- [ ] **Step 3: Build the modal**

Ant `Modal` + `Form` (layout vertical). Reuse the field controls listed above. Validation: ≥1 block and a positive weight before enabling submit. On success: toast, `onSuccess()`, `onClose()`. Map variety → `varieties:[id]`. Add `supply_draft.*` i18n keys (title, fields, submit, validation, toast) to all three JSON files, each in its own language.

- [ ] **Step 4: Run — expect pass** (`vitest run src/components/shipment/SupplyDraftModal.test.tsx`).

- [ ] **Step 5: Typecheck + commit**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
git add frontend/src/components/shipment/SupplyDraftModal.tsx frontend/src/components/shipment/SupplyDraftModal.test.tsx frontend/src/i18n/
git commit -m "feat(p3): SupplyDraftModal — create a supply draft outside the Sheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: "Create supply draft" button on the List

**Files:**
- Modify: `frontend/src/pages/export/ShipmentList.tsx` (~732-740, state + button + modal render)

**Interfaces:**
- Consumes: `SupplyDraftModal` (Task 9); the existing `canCreate` gate (`ShipmentList.tsx:219`).

- [ ] **Step 1: Wire it in**

Add `const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);`. Next to the existing "New Shipment" button (line 732-740), add a second button gated by the same `canCreate`, opening the supply modal. Render `<SupplyDraftModal open={isSupplyModalOpen} onClose={() => setIsSupplyModalOpen(false)} onSuccess={handleCreateSuccess} />`. Reuse `handleCreateSuccess` (invalidates `['shipments']`). Add the button label to i18n (`supply_draft.open_button`).

- [ ] **Step 2: Typecheck + full frontend suite**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/export/ShipmentList.tsx frontend/src/i18n/
git commit -m "feat(p3): Create-supply-draft button on the Shipment List

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Docs + changelog + build log

**Files:**
- Modify: `docs/obsidian/processes/draft-shipments.md`
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: Update `draft-shipments.md`**

- Line 33 (Finding #3, "Variety is not captured at draft creation"): add a note that the new **Create-supply-draft modal** (outside the Sheet) DOES capture variety at creation, per the product owner (2026-08-14); the morning-supply Sheet path is unchanged.
- Add a subsection "Create supply draft (outside the Sheet)" describing: the List button + modal; that `weight_kg` is now nullable so blocks are stored without weights; the declared total lives in `weight_net`; per-block weights are filled later (by the pallet manifest close or a future Detail editor); and that such a draft is joinable immediately (`block_sources.exists()` is true).

- [ ] **Step 2: CHANGELOG**

Under `[Unreleased]`:
- **Added**: Create-supply-draft modal on the Shipment List — records total weight + blocks (no per-block weights) + variety + harvest status; joinable immediately (feat(p3)).
- **Changed**: `ShipmentBlockSource.weight_kg` is now nullable; join preserves a supply draft's declared `weight_net` when its blocks are unweighed (feat(p3)/fix(p3)).

- [ ] **Step 3: BUILD_TEST_LOG**

Prepend: `- [ ] 2026-08-14 — Supply-draft creation (Phase C): nullable block weight, create-supply modal, join weight_net preservation — NEEDS TEST`.

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/processes/draft-shipments.md CHANGELOG.md BUILD_TEST_LOG.md
git commit -m "docs(p3): document supply-draft creation (Phase C)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Report honestly** — state plainly: *"Built — NOT tested in a browser yet. Did you test it?"* Do not tick the build-log item until the user confirms.

---

## Manual acceptance (product owner, after Task 11)

- On the List, a "Create supply draft" button is visible to `loading_dept_head` (and hidden where `canCreate` is false).
- The modal creates a draft with the entered total weight, the picked blocks (shown with "—"/blank weight on the Detail block-sources row), variety, harvest status.
- The new supply draft can be joined into a destination draft from the Sheet (existing Join), and the joined shipment keeps the declared total weight.
- All new strings appear in tk/ru/en.

---

## Self-review notes

**Spec coverage:** §3 nullable + consumer audit → Tasks 1, 2, 5, 6 (join, normalize, sales-report, weekly-plan already-safe noted). §4 backend create → Tasks 3, 4. §5 modal → Tasks 7, 8, 9, 10. §6 docs → Task 11. §7 tests → each task is TDD. The already-null-safe consumers (weekly-plan rollup, forecast pool, output serializers, `compute_block_variety_breakdown`) need **no** code change per the research; Task 4/5 tests exercise the paths that do.

**Correction applied:** the join fix (Task 5) implements source-declared-total fallback, not the spec's literal "keep target weight_net" (the target has none; the total is on the deleted source). Two null cases tested (all-null, mixed-null) plus the existing all-weighted recompute.

**Deferred (not this plan):** A/B join UI on Detail/List; D per-block weight editor on Detail (the pallet-manifest close and `set_block_sources` even-split endpoint already fill weights in — noted for that phase); quota enforcement on create/join (pre-existing gap).
