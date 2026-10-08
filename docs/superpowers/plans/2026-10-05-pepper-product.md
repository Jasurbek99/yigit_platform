# Pepper Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shipment carries an explicit product (tomato / pepper) that drives quota, documents, contracts, the weekly-plan totals and analytics; pepper blocks D, G, M5 and pepper varieties exist; product parameters are admin-editable.

**Architecture:** `core.ProductType` gains `code`/`hs_code`/names; varieties point at a product; a block's product is its main variety's (parent's for sub-blocks). `Shipment.product_type` is an explicit field: supply rows adopt their blocks' product, destination rows default to tomato, and every block-source write is checked against it. Quota calls, document contexts and framework-contract lookup read `shipment_product_code(shipment)` instead of the `'tomato'` literal.

**Tech Stack:** Django 5 + DRF, mssql-django (prod) / SQLite-or-MSSQL test DB, React 18 + TS + Ant Design + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-pepper-product-design.md`

## Global Constraints

- MSSQL: no JSONField/ArrayField/DISTINCT ON; `bulk_create`/`bulk_update` always `batch_size=500`; `CharField` always `max_length`; Cyrillic text fields use `**cyrillic_collation()`.
- Every new column is nullable (`null=True`) — beta runs old code on the same DB (memory: NOT NULL needs DB default).
- `on_delete=models.PROTECT` for every new reference FK.
- No reverse imports: `core ← greenhouse ← export ← contracts`. Core code must not import export.
- No Django signals. Status changes only via `transition_to()` (none needed here).
- Packing/block moves use `.update()` on Shipment, never `.save()` (no auto-advance).
- Product codes: exactly `tomato` and `pepper` (match `QuotaIssuance.PRODUCT_TYPE_CHOICES`).
- Pepper HS code: `0709601000`. Tomato HS code: `070200000` (unchanged constant `TOMATO_HS_CODE`).
- NULL product anywhere reads as tomato.
- UI never says "draft"/«черновик» (memory: no-draft-word).
- Migration numbers below are what is free on 2026-10-05. **Before writing each migration run** `ls backend/apps/<app>/migrations/ | tail -3` and `git log --oneline origin/main -5`; renumber if taken (parallel sessions).
- **Commits:** CLAUDE.md — never commit without the user saying "commit". Commit steps below are prepared commands; run them only after that instruction, after `git status` + `git diff --cached` show only this task's paths. Stage paths explicitly, never `git add -A`.
- Tests: run with a private DB to avoid collisions: `cd backend && TEST_DB_NAME=test_pepper_$RANDOM python manage.py test <labels> --noinput --verbosity=1`.
- Frontend typecheck: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken). Tests: `npx vitest run <path>`.

## Review Focus

1. A destination row (country+customer set) whose blocks are replaced with a different product's blocks must be refused, but a supply-only row must simply switch product — test both in Task 5.
2. Changing the product of a row that already has firm splits must move its `QuotaUsageRecord` rows to the new product and bust the quota caches — test in Task 5.
3. An admin blanking a product's `hs_code`/`name_*` must not break any document — falls back to tomato constants; test in Task 8.
4. Data migration on an empty test DB (no `ProductType`, no blocks D/G/M5) must not fail — every test run exercises it; plus explicit test in Task 1.
5. Framework contracts with `product_type` NULL (created by old beta code) must still be offered to tomato trucks — test in Task 7.

---

### Task 1: Product model fields, variety product, block product rule, data migration

**Files:**
- Modify: `backend/apps/core/models/products.py` (ProductType, TomatoVariety)
- Modify: `backend/apps/core/models/greenhouse_block.py` (add `resolve_product`)
- Create: `backend/apps/core/migrations/0073_product_type_fields.py` (schema, via makemigrations)
- Create: `backend/apps/core/migrations/0074_seed_pepper_products.py` (data)
- Test: `backend/apps/core/tests_product_type.py`

**Interfaces:**
- Produces: `ProductType.CODE_TOMATO = 'tomato'`, `ProductType.CODE_PEPPER = 'pepper'`, `ProductType.tomato() -> ProductType | None` (classmethod, `filter(code='tomato').first()`), fields `code, hs_code, name_en, name_ru, name_tk`; `TomatoVariety.product_type` FK; `GreenhouseBlock.resolve_product() -> ProductType | None`.

- [ ] **Step 1: Write the failing tests**

```python
"""ProductType fields, variety → product, block product rule (pepper spec 2026-10-05)."""
from django.test import TestCase

from apps.core.models import GreenhouseBlock, ProductType, TomatoVariety


class BlockProductRuleTests(TestCase):
    def setUp(self):
        self.tomato, _ = ProductType.objects.get_or_create(name='Pomidor')
        self.tomato.code = 'tomato'
        self.tomato.save()
        self.pepper, _ = ProductType.objects.get_or_create(name='Bolgar burç')
        self.pepper.code = 'pepper'
        self.pepper.save()
        self.defensiosa = TomatoVariety.objects.create(name='T-Def', product_type=self.tomato)
        self.maranella = TomatoVariety.objects.create(name='T-Mar', product_type=self.pepper)

    def test_block_product_is_main_variety_product(self):
        block = GreenhouseBlock.objects.create(code='XD', variety_main=self.maranella)
        self.assertEqual(block.resolve_product(), self.pepper)

    def test_sub_block_without_variety_inherits_parent(self):
        parent = GreenhouseBlock.objects.create(code='XF', variety_main=self.defensiosa)
        sub = GreenhouseBlock.objects.create(code='XF1', parent=parent)
        self.assertEqual(sub.resolve_product(), self.tomato)

    def test_block_without_variety_has_no_product(self):
        self.assertIsNone(GreenhouseBlock.objects.create(code='XN').resolve_product())

    def test_variety_without_product_gives_none(self):
        bare = TomatoVariety.objects.create(name='T-Bare')
        self.assertIsNone(GreenhouseBlock.objects.create(code='XB', variety_main=bare).resolve_product())

    def test_tomato_classmethod(self):
        self.assertEqual(ProductType.tomato(), self.tomato)


class SeedMigrationTests(TestCase):
    """The data migration ran on this (empty) test DB without failing."""

    def test_seeded_products_have_codes(self):
        self.assertTrue(ProductType.objects.filter(code='tomato', hs_code='070200000').exists())
        self.assertTrue(ProductType.objects.filter(code='pepper', hs_code='0709601000').exists())

    def test_pepper_varieties_exist(self):
        names = set(
            TomatoVariety.objects.filter(product_type__code='pepper').values_list('name', flat=True)
        )
        self.assertEqual(names, {'Maranella', 'Gialte', 'Redwing', 'Camier'})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && TEST_DB_NAME=test_pepper_1 python manage.py test apps.core.tests_product_type --noinput`
Expected: FAIL — `TomatoVariety() got unexpected keyword 'product_type'` / no attribute `resolve_product`.

- [ ] **Step 3: Model changes**

In `products.py`, `ProductType`:

```python
class ProductType(models.Model):
    """Product types (Pomidor, Bolgar burç, etc.).

    `code` bridges to the quota/packing CharField (`tomato` / `pepper`); the
    hs_code and names feed the documents (pepper spec 2026-10-05). All nullable:
    beta runs old code on the same DB.
    """

    CODE_TOMATO = 'tomato'
    CODE_PEPPER = 'pepper'

    name = models.CharField(max_length=50, unique=True)
    code = models.CharField(max_length=20, unique=True, null=True, blank=True)
    hs_code = models.CharField(max_length=20, null=True, blank=True)
    name_en = models.CharField(max_length=100, null=True, blank=True)
    name_ru = models.CharField(max_length=100, null=True, blank=True, **cyrillic_collation())
    name_tk = models.CharField(max_length=100, null=True, blank=True, **cyrillic_collation())

    class Meta:
        db_table = schema_table('core', 'product_types')

    def __str__(self) -> str:
        return self.name

    @classmethod
    def tomato(cls) -> 'ProductType | None':
        return cls.objects.filter(code=cls.CODE_TOMATO).first()
```

Add `from apps.core.db_utils import cyrillic_collation, schema_table` (replace the existing `schema_table` import). Move `ProductType` above `TomatoVariety` in the file is NOT needed — use the string FK. In `TomatoVariety` add:

```python
    product_type = models.ForeignKey(
        'core.ProductType', on_delete=models.PROTECT, null=True, blank=True,
        related_name='varieties',
    )
```

In `greenhouse_block.py`, inside `GreenhouseBlock`:

```python
    def resolve_product(self):
        """The product this block grows: its main variety's, else its parent's.

        Sub-blocks (F1/F2, OD/OG) usually carry no variety of their own. None when
        neither has a variety with a product — such blocks never decide a truck's
        product (pepper spec 2026-10-05 §1).
        """
        for block in (self, self.parent):
            variety = getattr(block, 'variety_main', None) if block else None
            if variety is not None and variety.product_type_id is not None:
                return variety.product_type
        return None
```

- [ ] **Step 4: Schema migration**

Check numbers (Global Constraints), then:
Run: `cd backend && python manage.py makemigrations core -n product_type_fields`
Expected: `0073_product_type_fields.py` with 5 AddField on producttype + 1 on tomatovariety.

- [ ] **Step 5: Data migration** `0074_seed_pepper_products.py`

```python
"""Seed product codes / HS codes / names, tag varieties, add pepper varieties,
put pepper on blocks D, G, M5 (2026-2027 owner table). Fills blanks only;
idempotent; safe on an empty test DB."""
from django.db import migrations

PRODUCTS = {
    'Pomidor': dict(code='tomato', hs_code='070200000', name_en='Fresh tomatoes',
                    name_ru='Помидор свежий', name_tk='Ter pomidor'),
    'Bolgar burç': dict(code='pepper', hs_code='0709601000', name_en='Fresh sweet peppers',
                        name_ru='Перец сладкий свежий', name_tk='Ter bolgar burç'),
}
PEPPER_VARIETIES = ['Maranella', 'Gialte', 'Redwing', 'Camier']
PEPPER_BLOCKS = {'D': ('Maranella', 'Gialte'), 'G': ('Redwing', 'Camier'), 'M5': ('Maranella', 'Gialte')}


def seed(apps, schema_editor):
    ProductType = apps.get_model('core', 'ProductType')
    TomatoVariety = apps.get_model('core', 'TomatoVariety')
    GreenhouseBlock = apps.get_model('core', 'GreenhouseBlock')

    products = {}
    for name, values in PRODUCTS.items():
        product, _ = ProductType.objects.get_or_create(name=name)
        for field, value in values.items():
            if not getattr(product, field):
                setattr(product, field, value)
        product.save()
        products[values['code']] = product

    TomatoVariety.objects.filter(product_type__isnull=True).update(product_type=products['tomato'])
    pepper_by_name = {}
    for name in PEPPER_VARIETIES:
        variety, _ = TomatoVariety.objects.get_or_create(
            name=name, defaults={'product_type': products['pepper']},
        )
        pepper_by_name[name] = variety

    for code, (main, secondary) in PEPPER_BLOCKS.items():
        GreenhouseBlock.objects.filter(code=code).update(
            variety_main=pepper_by_name[main], variety_secondary=pepper_by_name[secondary],
        )


class Migration(migrations.Migration):
    dependencies = [('core', '0073_product_type_fields')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
```

Note: `TomatoVariety.objects.filter(product_type__isnull=True).update(...)` runs **before** the pepper `get_or_create`, so only pre-existing varieties become tomato.

- [ ] **Step 6: Apply + run tests**

Run: `cd backend && python manage.py migrate core && python manage.py showmigrations core | tail -3`
Run: `TEST_DB_NAME=test_pepper_1 python manage.py test apps.core.tests_product_type --noinput`
Expected: 7 tests PASS. Then on the dev DB: `python manage.py shell -c "from apps.core.models import GreenhouseBlock as B; print([(b.code, b.variety_main.name) for b in B.objects.filter(code__in=['D','G','M5'])])"` → Maranella / Redwing / Maranella.

- [ ] **Step 7: Commit (only on "commit")**

```bash
git add backend/apps/core/models/products.py backend/apps/core/models/greenhouse_block.py backend/apps/core/migrations/0073_product_type_fields.py backend/apps/core/migrations/0074_seed_pepper_products.py backend/apps/core/tests_product_type.py
git commit -m "feat(core): product codes, HS codes and names; pepper varieties on D, G, M5"
```

---

### Task 2: Core API — product-types endpoint, variety product, block product code

**Files:**
- Modify: `backend/apps/core/serializers.py` (new `ProductTypeSerializer`; `TomatoVarietySerializer`; `GreenhouseBlockSerializer`)
- Modify: `backend/apps/core/views.py` (new `ProductTypeViewSet` after `TomatoVarietyViewSet`)
- Modify: `backend/apps/core/urls/core.py` (register `product-types`)
- Modify: `backend/apps/greenhouse/views_admin.py` (`GreenhouseBlockAdminSerializer` + `product_type_code`)
- Test: `backend/apps/core/tests_product_type_api.py`

**Interfaces:**
- Consumes: Task 1 model fields, `GreenhouseBlock.resolve_product()`.
- Produces: `GET/POST/PATCH/DELETE /api/v1/core/product-types/` rows `{id, name, code, hs_code, name_en, name_ru, name_tk}`; variety rows gain `product_type` (id, writable) + `product_type_code` (read-only); block rows (`/core/blocks/`, admin blocks) gain `product_type_code`.

- [ ] **Step 1: Failing tests**

```python
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, ProductType, TomatoVariety, User


def _user(username, role):
    u = User(username=username, role=role)
    u.set_password('pass')
    u.save()
    return u


class ProductTypeApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        self.client = APIClient()
        self.pepper = ProductType.objects.get(code='pepper')

    def test_any_user_reads(self):
        self.client.force_authenticate(_user('s1', 'sales_rep'))
        resp = self.client.get('/api/v1/core/product-types/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        pepper = next(r for r in rows if r['code'] == 'pepper')
        self.assertEqual(pepper['hs_code'], '0709601000')

    def test_admin_edits_hs_code(self):
        self.client.force_authenticate(_user('a1', 'admin'))
        resp = self.client.patch(f'/api/v1/core/product-types/{self.pepper.id}/', {'hs_code': '0709601001'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.pepper.refresh_from_db()
        self.assertEqual(self.pepper.hs_code, '0709601001')

    def test_sales_rep_cannot_write(self):
        self.client.force_authenticate(_user('s2', 'sales_rep'))
        resp = self.client.patch(f'/api/v1/core/product-types/{self.pepper.id}/', {'hs_code': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_delete_in_use_is_refused(self):
        self.client.force_authenticate(_user('a2', 'admin'))
        resp = self.client.delete(f'/api/v1/core/product-types/{self.pepper.id}/')
        self.assertEqual(resp.status_code, 400)

    def test_variety_and_block_expose_product_code(self):
        self.client.force_authenticate(_user('a3', 'admin'))
        maranella = TomatoVariety.objects.get(name='Maranella')
        GreenhouseBlock.objects.create(code='ZP', variety_main=maranella)
        v = self.client.get(f'/api/v1/core/tomato-varieties/{maranella.id}/').data
        self.assertEqual(v['product_type_code'], 'pepper')
        blocks = self.client.get('/api/v1/core/blocks/?page_size=200').data
        rows = blocks['results'] if isinstance(blocks, dict) else blocks
        self.assertEqual(next(b for b in rows if b['code'] == 'ZP')['product_type_code'], 'pepper')
```

- [ ] **Step 2: Run** `TEST_DB_NAME=test_pepper_2 python manage.py test apps.core.tests_product_type_api --noinput` → FAIL (404 on product-types).

- [ ] **Step 3: Implement**

`core/serializers.py`:

```python
class ProductTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductType
        fields = ['id', 'name', 'code', 'hs_code', 'name_en', 'name_ru', 'name_tk']


class TomatoVarietySerializer(serializers.ModelSerializer):
    product_type_code = serializers.CharField(source='product_type.code', read_only=True, default=None)

    class Meta:
        model = TomatoVariety
        fields = [
            'id', 'name', 'type', 'avg_fruit_weight_gr',
            'code', 'is_experimental', 'scientific_name', 'color', 'sort_order',
            'product_type', 'product_type_code',
        ]
```

`GreenhouseBlockSerializer`: add `product_type_code = serializers.SerializerMethodField()` + `'product_type_code'` in `fields` +

```python
    def get_product_type_code(self, obj) -> str | None:
        product = obj.resolve_product()
        return product.code if product else None
```

Same field + method on `GreenhouseBlockAdminSerializer` in `greenhouse/views_admin.py`. Add `.select_related('variety_main__product_type', 'parent__variety_main__product_type')` to both block viewsets' querysets (core `views.py:~199`, `greenhouse/views_admin.py:~123`).

`core/views.py` (import `ProductType`, `ProductTypeSerializer`; `ProtectedError` from `django.db.models`):

```python
class ProductTypeViewSet(ModelViewSet):
    """CRUD /api/v1/core/product-types/ — reads open, writes REFERENCE_DATA_WRITE.

    Delete of a product still referenced by varieties/shipments/contracts → 400.
    """

    permission_classes = [IsAuthenticated, write_permission(*REFERENCE_DATA_WRITE)]
    serializer_class = ProductTypeSerializer
    queryset = ProductType.objects.order_by('id')

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response({'error': 'Product is in use.'}, status=status.HTTP_400_BAD_REQUEST)
```

`urls/core.py`: `router.register('product-types', ProductTypeViewSet, basename='product-type')`.

Note: `Shipment.product_type` is `SET_NULL` today — Task 4 does not change that, so the in-use guard relies on `TomatoVariety.product_type` (PROTECT) and `Contract.product_type` (PROTECT, Task 7). The test passes because seeded pepper varieties reference pepper.

- [ ] **Step 4: Run** → 5 PASS. Also `TEST_DB_NAME=test_pepper_2 python manage.py test apps.core.tests_reference_data_perms apps.core.tests_block_list_fields --noinput` → PASS.

- [ ] **Step 5: Commit (only on "commit")** — `git add` the 5 files; message `feat(core): product-types endpoint; product on varieties and blocks`.

---

### Task 3: Shipment product service

**Files:**
- Create: `backend/apps/export/services/product_type.py`
- Test: `backend/apps/export/tests_product_type_service.py`

**Interfaces:**
- Consumes: `ProductType.tomato()`, `GreenhouseBlock.resolve_product()`.
- Produces:
  - `class ProductMismatchError(ValueError)`; constants `MIXED_PRODUCT = 'mixed_product'`, `PRODUCT_MISMATCH = 'product_mismatch'` (the exception message is one of these codes)
  - `product_code(product) -> str` — `product.code` or `'tomato'`
  - `shipment_product_code(shipment) -> str`
  - `resolve_product_type(block_ids) -> ProductType | None`
  - `is_destination_plan(shipment) -> bool` — `bool(shipment.country_id and shipment.customer_id)`
  - `check_blocks_fit(shipment, block_ids) -> ProductType | None` — returns the product to adopt, or None for "no change"
  - `set_shipment_product(shipment, product, user) -> bool`

- [ ] **Step 1: Failing tests**

```python
import datetime

from django.test import TestCase

from apps.core.models import Country, Customer, GreenhouseBlock, ProductType, Season, ShipmentStatusType, TomatoVariety, User
from apps.export.models import QuotaUsageRecord, Shipment, ShipmentBlockSource, ShipmentFirmSplit
from apps.export.services.product_type import (
    ProductMismatchError, check_blocks_fit, resolve_product_type, set_shipment_product, shipment_product_code,
)


class ProductServiceTests(TestCase):
    def setUp(self):
        self.tomato = ProductType.objects.get(code='tomato')
        self.pepper = ProductType.objects.get(code='pepper')
        t = TomatoVariety.objects.create(name='S-Tom', product_type=self.tomato)
        p = TomatoVariety.objects.get(name='Maranella')
        self.tb = GreenhouseBlock.objects.create(code='ST', variety_main=t)
        self.pb = GreenhouseBlock.objects.create(code='SP', variety_main=p)
        self.nb = GreenhouseBlock.objects.create(code='SN')
        season, _ = Season.objects.get_or_create(name='ps-test', defaults={'start_date': '2026-08-01', 'end_date': '2027-07-01', 'is_active': True})
        status, _ = ShipmentStatusType.objects.get_or_create(code='draft', defaults={'name_tk': 'd', 'name_en': 'd', 'step_order': 0, 'phase': 'DRAFT'})
        self.user = User.objects.create(username='ps', role='admin')
        self.ship = Shipment.objects.create(shipment_code='0110001/26', date=datetime.date(2026, 10, 1), season=season, status=status, created_by=self.user, product_type=self.tomato)

    def test_resolve_ignores_blocks_without_product(self):
        self.assertEqual(resolve_product_type([self.pb.id, self.nb.id]), self.pepper)
        self.assertIsNone(resolve_product_type([self.nb.id]))

    def test_resolve_mixed_raises(self):
        with self.assertRaisesMessage(ProductMismatchError, 'mixed_product'):
            resolve_product_type([self.tb.id, self.pb.id])

    def test_supply_row_adopts_new_product(self):
        ShipmentBlockSource.objects.create(shipment=self.ship, block=self.tb)
        self.assertEqual(check_blocks_fit(self.ship, [self.pb.id]), self.pepper)

    def test_destination_row_refuses_other_product(self):
        self.ship.country = Country.objects.create(code='PZ', name_en='P', name_ru='P', name_tk='P')
        self.ship.customer = Customer.objects.create(name='PC')
        self.ship.save(update_fields=['country', 'customer'])
        with self.assertRaisesMessage(ProductMismatchError, 'product_mismatch'):
            check_blocks_fit(self.ship, [self.pb.id])

    def test_same_product_is_no_change(self):
        self.assertIsNone(check_blocks_fit(self.ship, [self.tb.id]))

    def test_null_product_reads_tomato(self):
        Shipment.objects.filter(pk=self.ship.pk).update(product_type=None)
        self.ship.refresh_from_db()
        self.assertEqual(shipment_product_code(self.ship), 'tomato')
        self.assertIsNone(check_blocks_fit(self.ship, [self.tb.id]))

    def test_set_product_moves_quota_rows(self):
        from apps.core.models import ExportFirm
        firm = ExportFirm.objects.create(code='PF', name='PF')
        ShipmentFirmSplit.objects.create(shipment=self.ship, export_firm=firm, weight_kg=18000, split_order=1)
        self.assertTrue(set_shipment_product(self.ship, self.pepper, self.user))
        self.assertEqual(set(self.ship.quota_usage_records.values_list('product_type', flat=True)), {'pepper'})
```

(If `ExportFirm`/`Country` require more fields, copy the factory from `tests_quota_firm_balances.py`.)

- [ ] **Step 2: Run** `TEST_DB_NAME=test_pepper_3 python manage.py test apps.export.tests_product_type_service --noinput` → FAIL (ImportError).

- [ ] **Step 3: Implement** `services/product_type.py`

```python
"""A shipment's product (tomato / pepper) — pepper spec 2026-10-05 §2.

The product is an explicit Shipment field. Supply-only rows take it from their
blocks; a destination plan (country + customer set) keeps it, because its
documents are prepared before the Join — so a block of another product is
refused there. NULL reads as tomato everywhere.
"""
from django.db import transaction

from apps.core.models import GreenhouseBlock, ProductType

MIXED_PRODUCT = 'mixed_product'
PRODUCT_MISMATCH = 'product_mismatch'


class ProductMismatchError(ValueError):
    """Message is MIXED_PRODUCT or PRODUCT_MISMATCH (frontend i18n keys errors.*)."""


def product_code(product) -> str:
    return getattr(product, 'code', None) or ProductType.CODE_TOMATO


def shipment_product_code(shipment) -> str:
    return product_code(shipment.product_type)


def resolve_product_type(block_ids):
    blocks = GreenhouseBlock.objects.filter(id__in=list(block_ids)).select_related(
        'variety_main__product_type', 'parent__variety_main__product_type',
    )
    products = {p.id: p for p in (b.resolve_product() for b in blocks) if p is not None}
    if len(products) > 1:
        raise ProductMismatchError(MIXED_PRODUCT)
    return next(iter(products.values()), None)


def is_destination_plan(shipment) -> bool:
    return bool(shipment.country_id and shipment.customer_id)


def check_blocks_fit(shipment, block_ids):
    product = resolve_product_type(block_ids)
    if product is None or product.code == shipment_product_code(shipment):
        return None
    if is_destination_plan(shipment):
        raise ProductMismatchError(PRODUCT_MISMATCH)
    return product


def set_shipment_product(shipment, product, user) -> bool:
    """Write the product with .update() (no auto-advance) and re-sync quota usage."""
    from apps.export.models import Shipment
    from apps.export.services.quota_sync import invalidate_quota_caches, sync_draft_quota_usage_for_shipment

    if product is None or shipment.product_type_id == product.id:
        return False
    Shipment.objects.filter(pk=shipment.pk).update(product_type=product)
    shipment.product_type = product
    if shipment.firm_splits.exists():
        sync_draft_quota_usage_for_shipment(shipment, user, product_type=product_code(product))
        transaction.on_commit(invalidate_quota_caches)
    return True
```

`invalidate_quota_caches()` exists at `services/quota_sync.py:35` (verified).

- [ ] **Step 4: Run** → 7 PASS.
- [ ] **Step 5: Commit (only on "commit")** — `feat(p3): shipment product service (resolve, fit check, set + quota resync)`.

---

### Task 4: Shipment product on create, serializers, list filter, backfill, Sheet row

**Files:**
- Modify: `backend/apps/export/serializers.py` — `ShipmentCreateSerializer` (+`product_type`), `ShipmentListSerializer` & `ShipmentSheetSerializer` (+`product_type`, `product_type_code`, `product_type_name`)
- Modify: `backend/apps/export/views.py` — `_create_draft_shipment` (~L2236-2300), non-draft branch (~L2175), list `get_queryset` (~L593, filter), queryset `select_related` (~L389)
- Modify: `backend/apps/export/services/shipment.py::create_shipment` (+`product_type=None`)
- Modify: `backend/apps/export/sheet_rows.py` (new row after `variety`)
- Create: `backend/apps/export/migrations/0097_backfill_shipment_product.py`
- Create: `backend/apps/export/migrations/0098_seed_product_type_row.py`
- Test: `backend/apps/export/tests_shipment_product.py`

**Interfaces:**
- Consumes: Task 3 `resolve_product_type`, `ProductMismatchError`, `PRODUCT_MISMATCH`; `ProductType.tomato()`.
- Produces: shipment API fields `product_type` (id), `product_type_code`, `product_type_name`; `?product_type=tomato|pepper` list filter; Sheet row `field_key='product_type'`, `row_number=51`, `input_type='dropdown'`, `options_source='productTypes'`.

- [ ] **Step 1: Failing tests** (reuse the `_make_*` helpers pattern from `tests_shipment_join.py`; call `call_command('seed_permissions')` in `setUpTestData`)

```python
class ShipmentProductCreateTests(TestCase):
    # setUp: export_manager user, loading_dept_head user, season, draft status,
    # pepper block 'QP' (variety Maranella), tomato block 'QT'.

    def test_supply_draft_from_pepper_block_is_pepper(self):
        self.client.force_authenticate(self.loading)
        resp = self.client.post('/api/v1/export/shipments/', {
            'is_draft': True, 'skip_forecast_check': True,
            'block_sources': [{'block_id': self.pb.id, 'weight_kg': '16800'}],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'pepper')

    def test_supply_draft_mixed_blocks_is_400(self):
        self.client.force_authenticate(self.loading)
        resp = self.client.post('/api/v1/export/shipments/', {
            'is_draft': True, 'skip_forecast_check': True,
            'block_sources': [{'block_id': self.pb.id, 'weight_kg': '8000'},
                              {'block_id': self.tb.id, 'weight_kg': '8000'}],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Shipment.objects.count(), 0)

    def test_destination_row_defaults_to_tomato(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {'is_draft': True, 'country': self.country.id, 'customer': self.customer.id}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['product_type_code'], 'tomato')

    def test_destination_row_can_be_created_as_pepper(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post('/api/v1/export/shipments/', {'is_draft': True, 'country': self.country.id, 'customer': self.customer.id, 'product_type': self.pepper.id}, format='json')
        self.assertEqual(resp.data['product_type_code'], 'pepper')

    def test_list_filter_by_product(self):
        # create one tomato + one pepper shipment directly, then:
        self.client.force_authenticate(self.em)
        resp = self.client.get('/api/v1/export/shipments/?product_type=pepper')
        codes = {r['product_type_code'] for r in resp.data['results']}
        self.assertEqual(codes, {'pepper'})
```

Before writing these, read `frontend/src/components/sheet/DestinationDraftModal.tsx:~172` and copy its exact `is_draft: true` payload for the destination tests — `ShipmentCreateSerializer.validate` only checks `block_sources` when present, but other required keys may exist.

- [ ] **Step 2: Run** `TEST_DB_NAME=test_pepper_4 python manage.py test apps.export.tests_shipment_product --noinput` → FAIL (`product_type_code` missing).

- [ ] **Step 3: Serializers**

`ShipmentCreateSerializer` — add after `varieties`:

```python
    # Pepper spec 2026-10-05: explicit product. Omitted → derived from the blocks,
    # else tomato. Sent AND blocks of another product → 400.
    product_type = serializers.PrimaryKeyRelatedField(
        queryset=ProductType.objects.all(), required=False, allow_null=True,
    )
```

`ShipmentListSerializer` (Detail inherits it) and `ShipmentSheetSerializer` — add declared fields and append `'product_type', 'product_type_code', 'product_type_name'` to both `fields` lists (List next to `'variety_name'`; Sheet in the `# Product` line):

```python
    product_type_code = serializers.CharField(source='product_type.code', read_only=True, default=None)
    product_type_name = serializers.CharField(source='product_type.name', read_only=True, default=None)
```

Import `ProductType` from `apps.core.models` at the top of `serializers.py`.

- [ ] **Step 4: Create paths**

In `_create_draft_shipment`, before `Shipment.objects.create(` (inside the atomic block):

```python
            from apps.core.models import ProductType
            from apps.export.services.product_type import PRODUCT_MISMATCH, resolve_product_type

            block_ids_for_product = [b.id for b in (data.get('block_ids') or [])] + [
                row['block_id'].id for row in bs_rows
            ]
            product = resolve_product_type(block_ids_for_product)  # raises ProductMismatchError(ValueError)
            requested = data.get('product_type')
            if product is not None and requested is not None and requested.id != product.id:
                raise ValueError(PRODUCT_MISMATCH)
            product = product or requested or ProductType.tomato()
```

and pass `product_type=product,` into `Shipment.objects.create(...)`. `create()` already maps `ValueError` → 400 `{'error': str(exc)}`.

Non-draft branch: pass `product_type=data.get('product_type')` to `create_shipment`; in `create_shipment` add parameter `product_type=None` (docstring line) and `product_type=product_type or ProductType.tomato(),` in its `Shipment.objects.create` (import `ProductType` with `ShipmentStatusType`).

List filter, next to `?phase=`:

```python
        if product_code := self.request.query_params.get('product_type'):
            if product_code == 'tomato':
                qs = qs.filter(Q(product_type__code='tomato') | Q(product_type__isnull=True))
            else:
                qs = qs.filter(product_type__code=product_code)
```

Add `'product_type'` to the viewset queryset `select_related(...)` at ~L389.

- [ ] **Step 5: Backfill migration** `0097_backfill_shipment_product.py`

```python
from django.db import migrations


def backfill(apps, schema_editor):
    ProductType = apps.get_model('core', 'ProductType')
    Shipment = apps.get_model('export', 'Shipment')
    tomato = ProductType.objects.filter(code='tomato').first()
    if tomato is not None:
        Shipment.objects.filter(product_type__isnull=True).update(product_type=tomato)


class Migration(migrations.Migration):
    dependencies = [('export', '0096_seed_export_date_row'), ('core', '0074_seed_pepper_products')]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
```

Then pepper blocks' existing shipments: none expected on beta yet (D/G/M5 were tomato until Task 1). Leave as tomato.

- [ ] **Step 6: Sheet row**

`sheet_rows.py`, right after the `variety` row dict:

```python
    {
        # Pepper spec 2026-10-05: tomato / pepper. Destination rows default to
        # tomato; supply rows take it from their blocks. Drives quota + documents.
        'row_number': 51,
        'field_key': 'product_type',
        'default_who_key': 'sheet.who.gadam',
        'label_key': 'sheet.row.product_type',
        'input_type': 'dropdown',
        'style': 'base',
        'options_source': 'productTypes',
    },
```

`0098_seed_product_type_row.py` — copy `0096_seed_export_date_row.py` verbatim with:
`FIELD_KEY = 'product_type'`, `AFTER_KEY = 'variety'`, `row_number` default 51 / `display_order` fallback `51 * 1024`,
`GRANT_ROLES = ['loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief']` (they already hold `product_type` in `seed_permissions.py`),
`TRIGGER_ROLES = ['admin', 'boss', 'director', 'export_manager', 'document_team'] + GRANT_ROLES`,
dependencies `[('export', '0097_backfill_shipment_product'), ('core', '0074_seed_pepper_products')]`.
Keep the `test_` DB-name skip and `_wipe_perm_cache()`.

Then run the Sheet permission regression the memory requires: `TestEveryRoleCanEditItsOwnSheetRow`.

- [ ] **Step 7: Run**

`python manage.py migrate export && python manage.py makemigrations --check`
`TEST_DB_NAME=test_pepper_4 python manage.py test apps.export.tests_shipment_product apps.export.tests_shipment_join apps.export.tests_supply_draft --noinput` → PASS.
`grep -rn "TestEveryRoleCanEditItsOwnSheetRow" apps/` → run that test module → PASS.

- [ ] **Step 8: Commit (only on "commit")** — `feat(p3): explicit shipment product on create, Sheet row, list filter`.

---

### Task 5: Guard every block-source write; PATCH product; quota re-sync on change

**Files:**
- Modify: `backend/apps/export/services/block_sources.py::write_block_sources`
- Modify: `backend/apps/export/views.py` — `set_block_sources` (~L3371), `_validate_join` (~L2560-2584), `partial_update` (~L698-790)
- Modify: `backend/apps/export/serializers.py::ShipmentPatchSerializer.validate`
- Modify: `backend/apps/export/services/packaging.py` — `unjoin_packing` (~L141), `swap_packing` (~L200)
- Test: `backend/apps/export/tests_shipment_product_guards.py`

**Interfaces:**
- Consumes: Task 3 `check_blocks_fit`, `set_shipment_product`, `resolve_product_type`, `shipment_product_code`, `ProductMismatchError`, `PRODUCT_MISMATCH`.
- Produces: 400 `{'error': 'mixed_product' | 'product_mismatch'}` from block-sources / join / swap; PATCH 400 `{'product_type': ['product_mismatch']}`.

- [ ] **Step 1: Failing tests**

```python
class ProductGuardTests(TestCase):
    # setUp as Task 4 + export_manager self.em, a destination plan self.dest
    # (country+customer, tomato, no blocks), a supply row self.supply_p from block QP (pepper).

    def test_block_edit_on_supply_row_switches_product(self):
        # supply row from tomato block QT, then POST block-sources [QP] → 200, product pepper
        ...
        self.assertEqual(Shipment.objects.get(pk=row.pk).product_type.code, 'pepper')

    def test_block_edit_on_destination_row_refused(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post(f'/api/v1/export/shipments/{self.dest.id}/block-sources/', {'blocks': [{'block_id': self.pb.id, 'weight_kg': 16800}]}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'product_mismatch')
        self.assertFalse(self.dest.block_sources.exists())

    def test_join_pepper_supply_into_tomato_destination_refused(self):
        self.client.force_authenticate(self.em)
        resp = self.client.post(f'/api/v1/export/shipments/{self.dest.id}/join/', {'source_id': self.supply_p.id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Shipment.objects.filter(pk=self.supply_p.pk).exists())

    def test_patch_product_with_blocks_of_other_product_refused(self):
        # dest joined with a tomato supply → PATCH product_type=pepper → 400
        ...

    def test_patch_product_without_blocks_moves_quota(self):
        # dest with a firm split, no blocks → PATCH product_type=pepper → 200,
        # quota_usage_records all product_type='pepper'
        ...

    def test_swap_between_products_refused(self):
        from apps.export.services.packaging import swap_packing
        with self.assertRaisesMessage(ValueError, 'product_mismatch'):
            swap_packing(tomato_row_with_packing, pepper_row_with_packing, self.em)

    def test_unjoin_copies_product(self):
        from apps.export.services.packaging import unjoin_packing
        new = unjoin_packing(pepper_destination_with_packing, self.em)
        self.assertEqual(new.product_type.code, 'pepper')
```

Fill the `...` bodies with direct ORM setup (create `ShipmentBlockSource`, `ShipmentFirmSplit`, packing fields as in `tests_packing.py`); every test must assert a concrete status and DB state as shown.

- [ ] **Step 2: Run** `TEST_DB_NAME=test_pepper_5 python manage.py test apps.export.tests_shipment_product_guards --noinput` → FAIL.

- [ ] **Step 3: `write_block_sources`** — after `merged = merge_to_parent(entries, parent_map)`:

```python
    from apps.export.services.product_type import check_blocks_fit, set_shipment_product

    # Pepper spec §2: refuse a block of another product on a destination plan
    # before anything is written; a supply-only row adopts the new product.
    adopt = check_blocks_fit(shipment, {block_id for block_id, _ in merged})
```

and, inside the `with transaction.atomic():` after the `bulk_create`:

```python
        if adopt is not None:
            set_shipment_product(shipment, adopt, user=None)
```

`user=None` is safe: `QuotaUsageRecord.created_by` is `null=True, SET_NULL` (verified 2026-10-05).

- [ ] **Step 4: `set_block_sources` view** — wrap the existing `with transaction.atomic(): count = write_block_sources(...)` block:

```python
        from apps.export.services.product_type import ProductMismatchError
        try:
            with transaction.atomic():
                ...existing body unchanged...
        except ProductMismatchError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
```

- [ ] **Step 5: Join** — `_validate_join`, before `return None`:

```python
        from apps.export.services.product_type import PRODUCT_MISMATCH, shipment_product_code
        if shipment_product_code(source) != shipment_product_code(target):
            return PRODUCT_MISMATCH
```

Confirm the join view returns `_validate_join`'s string as `{'error': ...}` with 400 (it does for the other messages).

- [ ] **Step 6: Packaging** — `unjoin_packing`: add `product_type_id=row.product_type_id,` to the new `Shipment.objects.create(...)`. `swap_packing`: after the `for row in (a, b):` validation loop:

```python
        from apps.export.services.product_type import PRODUCT_MISMATCH, shipment_product_code
        if shipment_product_code(a) != shipment_product_code(b):
            raise ValueError(PRODUCT_MISMATCH)
```

- [ ] **Step 7: PATCH** — in `ShipmentPatchSerializer.validate`, right after the packing guard (before the role early-return):

```python
        if 'product_type' in attrs and self.instance is not None:
            from apps.export.services.product_type import PRODUCT_MISMATCH, product_code, resolve_product_type
            block_ids = list(self.instance.block_sources.values_list('block_id', flat=True))
            blocks_product = resolve_product_type(block_ids) if block_ids else None
            if blocks_product is not None and blocks_product.code != product_code(attrs['product_type']):
                raise serializers.ValidationError({'product_type': PRODUCT_MISMATCH})
```

In `partial_update`, inside the atomic block after `changed_keys` is computed:

```python
            if 'product_type' in changed_keys and instance.firm_splits.exists():
                from apps.export.services.product_type import shipment_product_code
                from apps.export.services.quota_sync import invalidate_quota_caches, sync_draft_quota_usage_for_shipment
                sync_draft_quota_usage_for_shipment(instance, request.user, product_type=shipment_product_code(instance))
                transaction.on_commit(invalidate_quota_caches)
```

- [ ] **Step 8: Run** → guard tests PASS; plus `apps.export.tests_packing apps.export.tests_shipment_join apps.export.tests_block_sources apps.export.tests_block_source_batches apps.export.tests_pallet_manifest` → PASS (compare against the pre-existing failure list in memory `project_beta_test_suite_failures` if any fail).
- [ ] **Step 9: Commit (only on "commit")** — `feat(p3): block writes, join, swap and product edits respect the shipment product`.

---

### Task 6: Quota calls use the shipment product

**Files:**
- Modify: `backend/apps/export/views.py` ~L2350 (create), ~L2384, ~L3445, ~L3500
- Modify: `backend/apps/contracts/views.py` ~L1154
- Modify: `backend/apps/export/services/quota_sync.py` docstring of `product_type` arg (drop "pepper support arrives when shipments carry product type")
- Test: `backend/apps/export/tests_quota_pepper.py`

**Interfaces:** Consumes `shipment_product_code`, `product_code`.

- [ ] **Step 1: Failing tests**

```python
class PepperQuotaTests(TestCase):
    # setUp: firm F with a tomato QuotaIssuance (50 000 kg) and NO pepper issuance;
    # pepper supply row; export_manager.

    def test_pepper_split_writes_pepper_usage(self):
        # POST /shipments/{pepper_row}/firm-splits/ with firm F → expect 400
        # "no remaining quota" because F has no PEPPER quota (tomato quota must not count)
        ...

    def test_pepper_split_with_pepper_quota(self):
        # add pepper QuotaIssuance for F → POST firm-splits → 200 and
        # QuotaUsageRecord rows product_type == 'pepper'
        ...

    def test_tomato_balance_untouched_by_pepper_truck(self):
        from apps.export.services_quota import compute_firm_quota_balances
        before = compute_firm_quota_balances('tomato', self.season)[self.firm.id]['remaining_kg']
        # pepper truck split as above
        after = compute_firm_quota_balances('tomato', self.season)[self.firm.id]['remaining_kg']
        self.assertEqual(before, after)
```

Build the `QuotaIssuance` exactly as `tests_quota_firm_balances.py` does, with `product_type='pepper'` / `'tomato'`.

- [ ] **Step 2: Run** → FAIL (pepper split counted against tomato).
- [ ] **Step 3: Implement**
  - ~L2350: `balances = compute_firm_quota_balances(product_code(product), season)` (`product` from Task 4 Step 4 is in scope); import `product_code`.
  - ~L2384 and ~L3500: `sync_draft_quota_usage_for_shipment(shipment, <user>, product_type=shipment_product_code(shipment))`.
  - ~L3445: `compute_firm_quota_balances(shipment_product_code(shipment), shipment.season)`; update the comment above it (no longer "defaults to 'tomato'").
  - `contracts/views.py:1154`: `sync_draft_quota_usage_for_shipment(shipment, user, product_type=shipment_product_code(shipment))` (import from `apps.export.services.product_type` — contracts may import export).
  - Update the comment at ~L2347 ("product_type 'tomato' matches every other call site") to say the draft's product.
- [ ] **Step 4: Run** → PASS; plus `apps.export.tests_quota_firm_balances apps.export.tests_quota_usage_no_approval apps.export.tests_draft_quota_block apps.contracts.tests.test_sale_quota_sync` → PASS.
- [ ] **Step 5: Commit (only on "commit")** — `fix(p3): pepper trucks draw pepper quota`.

---

### Task 7: Contract product (model, one-time inherit, framework filter, KZ contract text)

**Files:**
- Modify: `backend/apps/contracts/models/contract.py` (+`product_type`)
- Create: `backend/apps/contracts/migrations/0018_contract_product_type.py` (makemigrations) and `0019_backfill_contract_product.py`
- Modify: `backend/apps/contracts/services/shipment_firm_contracts.py` — `framework_contracts_for_pair`, `_create_one_time_contract`, `link_split_to_contract`
- Modify: `backend/apps/contracts/views.py` ~L935
- Modify: `backend/apps/contracts/serializers.py` — contract list/detail (L118 fields) + `ContractCreateSerializer` (+`product_type`, `product_type_code`)
- Modify: `backend/apps/contracts/services/document_context.py::build_contract_context`
- Modify: `backend/apps/contracts/document_templates/contract_kz.docx` (the «Томаты/ Pomidor» cell)
- Test: `backend/apps/contracts/tests/test_contract_product.py`

**Interfaces:**
- Consumes: `shipment_product_code`, `product_code`, `ProductType.tomato()`.
- Produces: `Contract.product_type` FK; `framework_contracts_for_pair(export_firm_id, import_firm_id, product_code='tomato')`; contract API `product_type` + `product_type_code`; contract context keys `product_name_ru`, `product_name_tk`; module helper `product_names(product) -> tuple[str, str, str]` (en, ru, tk with tomato fallbacks) placed in `document_context.py` and reused by Task 8.

- [ ] **Step 1: Failing tests**

```python
class ContractProductTests(TestCase):
    # setUp: export firm, import firm, season, pepper shipment with split + packing template,
    # tomato framework contract T (product Pomidor), legacy framework contract L (product NULL),
    # pepper framework contract P.

    def test_framework_options_follow_product(self):
        from apps.contracts.services.shipment_firm_contracts import framework_contracts_for_pair
        ids = set(framework_contracts_for_pair(self.ef.id, self.imf.id, 'pepper').values_list('id', flat=True))
        self.assertEqual(ids, {self.p.id})
        ids = set(framework_contracts_for_pair(self.ef.id, self.imf.id, 'tomato').values_list('id', flat=True))
        self.assertEqual(ids, {self.t.id, self.l.id})   # NULL ≡ tomato

    def test_link_pepper_truck_to_tomato_contract_refused(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        with self.assertRaises(ValueError):
            link_split_to_contract(shipment=self.pepper_ship, export_firm_id=self.ef.id, mode='framework', contract_id=self.t.id, user=self.user)

    def test_one_time_contract_inherits_pepper(self):
        from apps.contracts.services.shipment_firm_contracts import link_split_to_contract
        sale = link_split_to_contract(shipment=self.pepper_ship, export_firm_id=self.ef.id, mode='one_time', contract_id=None, user=self.user, price_per_kg='0.80')
        self.assertEqual(sale.contract.product_type.code, 'pepper')

    def test_contract_context_prints_product(self):
        from apps.contracts.services.document_context import build_contract_context
        ctx = build_contract_context(self.p)
        self.assertEqual((ctx['product_name_ru'], ctx['product_name_tk']), ('Перец сладкий свежий', 'Ter bolgar burç'))
        ctx = build_contract_context(self.l)
        self.assertEqual((ctx['product_name_ru'], ctx['product_name_tk']), ('Помидор свежий', 'Ter pomidor'))
```

Reuse fixtures from `tests/test_shipment_firm_contracts.py`.

- [ ] **Step 2: Run** `TEST_DB_NAME=test_pepper_7 python manage.py test apps.contracts.tests.test_contract_product --noinput` → FAIL.

- [ ] **Step 3: Model + migrations**

```python
    # Pepper spec 2026-10-05 §4.3: the goods this contract covers. NULL ≡ tomato
    # (rows written by old beta code).
    product_type = models.ForeignKey(
        'core.ProductType', on_delete=models.PROTECT, null=True, blank=True,
        related_name='contracts',
    )
```

`makemigrations contracts -n contract_product_type`, then `0019_backfill_contract_product.py` = the Task 4 backfill pattern on `contracts.Contract` (dependency on `('core', '0074_seed_pepper_products')`).

- [ ] **Step 4: Service**

```python
def framework_contracts_for_pair(export_firm_id: int, import_firm_id: int, product_code: str = 'tomato'):
    """Active framework contracts for a (seller, buyer) pair and product, newest first.

    product_type NULL counts as tomato (contracts created before the field).
    """
    qs = Contract.objects.filter(
        export_firm_id=export_firm_id,
        import_firm_id=import_firm_id,
        contract_type=Contract.TYPE_FRAMEWORK,
        status=Contract.STATUS_ACTIVE,
    )
    if product_code == 'tomato':
        qs = qs.filter(Q(product_type__code='tomato') | Q(product_type__isnull=True))
    else:
        qs = qs.filter(product_type__code=product_code)
    return qs.order_by('-contract_year', '-seq', '-created_at')
```

In `link_split_to_contract` framework branch pass `shipment_product_code(shipment)` as third arg (the existing "not an active framework contract for this pair" ValueError then covers a mismatch; reword it to `'contract_id is not an active framework contract for this pair and product.'`). In `_create_one_time_contract` add `product_type=shipment.product_type or ProductType.tomato(),`. In `contracts/views.py:~935` pass `shipment_product_code(shipment)`.

- [ ] **Step 5: Serializers** — add `'product_type'` to `ContractCreateSerializer.Meta.fields` and to the update serializer if separate; add `product_type_code = serializers.CharField(source='product_type.code', read_only=True, default=None)` + `'product_type', 'product_type_code'` in the list/detail serializer fields (L118). Create: default tomato when omitted — in `ContractCreateSerializer.create()` set `validated_data.setdefault('product_type', ProductType.tomato())`.

- [ ] **Step 6: Contract document**

In `document_context.py` add near `TOMATO_HS_CODE`:

```python
TOMATO_NAMES = ('Fresh tomatoes', 'Помидор свежий', 'Ter pomidor')


def product_names(product) -> tuple[str, str, str]:
    """(en, ru, tk) for a ProductType; each blank part falls back to tomato."""
    return tuple(
        (getattr(product, field, None) or '').strip() or fallback
        for field, fallback in zip(('name_en', 'name_ru', 'name_tk'), TOMATO_NAMES)
    )
```

`build_contract_context` return dict gains:

```python
        'product_name_ru': product_names(contract.product_type)[1],
        'product_name_tk': product_names(contract.product_type)[2],
```

Template: unzip `contract_kz.docx`, find the run(s) containing `Томаты` / `Pomidor` in `word/document.xml` (they may be split across `<w:r>` runs — merge into one run), replace with `{{ product_name_ru }}/ {{ product_name_tk }}`, rezip with the same file order (`python -c` with `zipfile`, copy every other member byte-for-byte). Verify: `unzip -p contract_kz.docx word/document.xml | sed 's/<[^>]*>//g' | grep -o "{{ product_name_[a-z]* }}"` prints both placeholders, and `grep -c Томаты` prints 0.

- [ ] **Step 7: Run** → PASS; plus `apps.contracts.tests.test_shipment_firm_contracts apps.contracts.tests.test_contract_api apps.contracts.tests.test_document_generation` → PASS. Render one KZ contract from the dev server and open it in Word to confirm the cell.
- [ ] **Step 8: Commit (only on "commit")** — `feat(p4): contracts carry a product; pepper trucks use pepper contracts`.

---

### Task 8: Invoice, CMR and customs letter print the shipment's product

**Files:**
- Modify: `backend/apps/contracts/services/document_context.py` — `build_invoice_context` (~L340-365), `build_cmr_context` / `build_cmr_overlay_values` (cargo_name), `build_customs_context` (~L1017)
- Test: `backend/apps/contracts/tests/test_document_product.py`

**Interfaces:** Consumes `product_names()` (Task 7), `TOMATO_HS_CODE`.

- [ ] **Step 1: Failing tests**

```python
class DocumentProductTests(TestCase):
    # fixtures: reuse test_document_generation.py's invoice + shipment builders,
    # set shipment.product_type = pepper.

    def test_invoice_pepper(self):
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '0709601000')
        self.assertEqual(ctx['line_items'][0]['name'], 'Fresh sweet peppers')

    def test_invoice_ru_pepper(self):
        self.assertEqual(build_invoice_context(self.invoice, 'ru')['line_items'][0]['name'], 'Перец сладкий свежий')

    def test_cmr_cargo_pepper(self):
        self.assertEqual(build_cmr_context(self.shipment, 'en')['cargo_name'], 'FRESH SWEET PEPPERS')

    def test_customs_letter_pepper(self):
        self.assertEqual(build_customs_context(self.invoice)['product'], 'Ter bolgar burç')

    def test_blank_admin_fields_fall_back_to_tomato(self):
        ProductType.objects.filter(code='pepper').update(hs_code='', name_en='', name_tk='')
        self.shipment.product_type.refresh_from_db()
        ctx = build_invoice_context(self.invoice, 'en')
        self.assertEqual(ctx['line_items'][0]['code'], '070200000')
        self.assertEqual(ctx['line_items'][0]['name'], 'Fresh tomatoes')
```

Confirm the exact context key for the CMR cargo (`cargo_name` comes from `_LOCALE`-like dict at ~L420; check whether `build_cmr_context` or `build_cmr_overlay_values` exposes it, and assert on that builder).

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```python
def _invoice_product(invoice):
    """The invoice's shipment product, else its contract's, else None (→ tomato)."""
    shipment = getattr(invoice, 'shipment', None)
    if shipment is not None and shipment.product_type_id:
        return shipment.product_type
    contract = getattr(invoice, 'contract', None)
    return getattr(contract, 'product_type', None)


def _hs_code(product) -> str:
    return (getattr(product, 'hs_code', None) or '').strip() or TOMATO_HS_CODE
```

- Invoice: `product = _invoice_product(invoice)`; `en, ru, _ = product_names(product)`; `default_name = en if lang == 'en' else ru`. Lines: `'name': line.product_name or default_name`, `'code': line.hs_code or _hs_code(product)`. Single synthesized line: `'name': default_name`, `'code': _hs_code(product)`. Remove `product_name` from `_LOCALE` only if nothing else reads it (grep `loc['product_name']`).
- CMR: wherever `loc['cargo_name']` is read, use `product_names(shipment.product_type)[0].upper()` for EN and `product_names(...)[1].upper()` for RU **only if** the RU `_LOCALE` has a `cargo_name` today; otherwise keep RU behaviour unchanged and apply EN only. (Check `_LOCALE['ru']` of the CMR locale dict first.)
- Customs: `'product': product_names(_invoice_product(invoice))[2],`.
- Keep `TOMATO_HS_CODE` exported (tests import it).
- [ ] **Step 4: Run** → PASS; plus `apps.contracts.tests.test_document_generation apps.contracts.tests.test_letterhead_render` → PASS.
- [ ] **Step 5: Commit (only on "commit")** — `feat(p4): documents print the shipment's product and HS code`.

---

### Task 9: Frontend — product types admin list, variety product

**Files:**
- Modify: `frontend/src/types/index.ts` — `IProductType`; `ITomatoVariety` (+`product_type`, `product_type_code`); `IGreenhouseBlock` (+`product_type_code`)
- Modify: `frontend/src/hooks/useAdmin.ts` — `useProductTypes`, `useCreateProductType`, `useUpdateProductType`, `useDeleteProductType`
- Modify: `frontend/src/pages/admin/shipment-settings/OptionListsTab.tsx` — FK category `product_type`; variety form/table product select/column
- Modify: `frontend/src/i18n/{en,ru,tk}.json`
- Test: `frontend/src/pages/admin/shipment-settings/OptionListsTab.productTypes.test.tsx`

**Interfaces:**
- Produces: `IProductType { id: number; name: string; code: string | null; hs_code: string | null; name_en: string | null; name_ru: string | null; name_tk: string | null }`; `useProductTypes()` queryKey `['product-types']` GET `/core/product-types/?page_size=200` (array-or-results like `useTomatoVarieties`).

- [ ] **Step 1: Failing test** — render `OptionListsTab` with mocked `useProductTypes` returning tomato+pepper (follow `OptionListsTab.carryDays.test.tsx` mocking style); select category «Продукты»; expect rows `Pomidor` / `0702 00 000`-style raw `070200000` and `Bolgar burç` / `0709601000`; open edit on pepper, change HS code, submit → `useUpdateProductType().mutate` called with `{ id: <pepper id>, hs_code: '<new>' }`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/pages/admin/shipment-settings/OptionListsTab.productTypes.test.tsx` → FAIL.
- [ ] **Step 3: Implement**
  - Hooks: copy the four tomato-variety hooks, swapping type/endpoint/queryKey; delete invalidates `['product-types']` and `['tomato-varieties']`.
  - `OptionListsTab`: add `'product_type'` to `FK_CATEGORIES` (after `'variety'`); a `normalizeProductType` → `IFKRow` (name, code, extra columns hs_code / name_en / name_ru / name_tk); wire query + mutations into the same switch statements the `variety` category uses (rows L447, delete L526, save L634); form fields:

```tsx
          {category === 'product_type' && (
            <>
              <Form.Item name="name" label={t('shipment_settings.col_name')} rules={[{ required: true, message: t('common.required') }]}><Input /></Form.Item>
              <Form.Item name="code" label={t('shipment_settings.col_code')}><Input placeholder="tomato / pepper" /></Form.Item>
              <Form.Item name="hs_code" label={t('shipment_settings.col_hs_code')}><Input /></Form.Item>
              <Form.Item name="name_en" label={t('shipment_settings.col_label_en')}><Input /></Form.Item>
              <Form.Item name="name_ru" label={t('shipment_settings.col_label_ru')}><Input /></Form.Item>
              <Form.Item name="name_tk" label={t('shipment_settings.col_label_tk')}><Input /></Form.Item>
            </>
          )}
```

  - Variety form: `<Form.Item name="product_type" label={t('shipment_settings.col_product')}><Select allowClear options={(productTypesQ.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Form.Item>`; variety table gains a product column (`product_type_code` → `t('product.tomato'|'product.pepper')`).
  - Delete 400 → existing `tError` toast shows `error`.
  - i18n (all three files): `shipment_settings.category.product_type` («Продукты» / «Products» / «Önümler»), `shipment_settings.col_hs_code` («ТН ВЭД» / «HS code» / «TN WED»), `shipment_settings.col_product` («Продукт» / «Product» / «Önüm»), `product.tomato` («Томат» / «Tomato» / «Pomidor»), `product.pepper` («Перец» / «Pepper» / «Burç»). Check `col_label_tk` exists; add if not. Match the existing category-label key pattern in `OptionListsTab` (grep how `variety` gets its label).
- [ ] **Step 4: Run** test → PASS; `npx tsc --noEmit --ignoreDeprecations 5.0` → no new errors; `npx vitest run src/pages/admin` → PASS.
- [ ] **Step 5: Commit (only on "commit")** — `feat(frontend): admin product list and variety product`.

---

### Task 10: Frontend — shipment product on Sheet, Detail, create, quota checks

**Files:**
- Modify: `frontend/src/types/index.ts` — shipment list/detail/sheet types + `product_type`, `product_type_code`, `product_type_name`
- Modify: `frontend/src/components/sheet/SheetCellEditor.tsx` (`getOptions` case `productTypes`; firm-balance product; variety filter)
- Modify: `frontend/src/components/sheet/getCellValue.ts` (`case 'product_type'`)
- Modify: `frontend/src/components/sheet/sheetTopicOrder.ts` (add `'product_type'` right after `'variety'`)
- Modify: `frontend/src/constants/shipmentEditConfig.ts` (`OptionsSource` + `'productTypes'`; goods section entry after `variety`)
- Modify: `frontend/src/components/FieldEditor.tsx` (case `'productTypes'`)
- Modify: `frontend/src/components/ExportFirmSelect.tsx`, `frontend/src/components/shipment/ShipmentFirmSelector.tsx` (product prop → `useQuotaFirmBalances(productType)`)
- Modify: `frontend/src/components/sheet/DestinationDraftModal.tsx` (destination-row create, payload at ~L172): product select, default tomato id. Also check `ShipmentCreateModal.tsx:71` and `useSheetCreate.ts:26` — add the field wherever a destination (country/customer) row is created
- Modify: mocks touched by type changes (`frontend/src/mock/shipment*.ts`)
- Modify: i18n — `sheet.row.product_type` («Продукт» / «Product» / «Önüm»), `errors.mixed_product`, `errors.product_mismatch`
- Test: `frontend/src/components/sheet/getCellValue.productType.test.ts`, extend `frontend/src/components/shipment/detailCoverage.test.tsx`

**Interfaces:** Consumes `useProductTypes()` (Task 9), API fields from Task 4, error codes from Task 5.

- [ ] **Step 1: Failing tests**

```ts
// getCellValue.productType.test.ts
import { describe, expect, it } from 'vitest';
import { getCellValue } from './getCellValue';
import { MOCK_SHEET_ROWS } from '@/mock/shipmentSheet'; // use whatever the export_date test imported

describe('product_type cell', () => {
  it('shows the product name', () => {
    const row = { ...MOCK_SHEET_ROWS[0], product_type: 2, product_type_code: 'pepper', product_type_name: 'Bolgar burç' };
    expect(getCellValue(row, 'product_type')).toBe('Bolgar burç');
  });
  it('dash when unknown', () => {
    expect(getCellValue({ ...MOCK_SHEET_ROWS[0], product_type_name: null }, 'product_type')).toBe('—');
  });
});
```

Mirror the signature and imports of `getCellValue.exportDate.test.ts` exactly. `detailCoverage.test.tsx`: the existing coverage test fails once the backend Sheet row exists in the mock row list — add `product_type` to the Detail goods config so it passes.

- [ ] **Step 2: Run** `npx vitest run src/components/sheet/getCellValue.productType.test.ts` → FAIL.
- [ ] **Step 3: Implement**
  - `getCellValue`: `case 'product_type': return shipment.product_type_name ?? '—';`
  - `SheetCellEditor.getOptions`: `case 'productTypes': case 'product_type': return (productTypes ?? []).filter((p) => p.code).map((p) => ({ value: p.id, label: p.name }));` (`const { data: productTypes } = useProductTypes();` next to `useTomatoVarieties()`).
  - `SheetCellEditor` L117: `useQuotaFirmBalances(shipment.product_type_code ?? 'tomato', { enabled: isFirmsCell })`.
  - `SheetCellEditor` varieties case: `(varieties ?? []).filter((v) => !shipment.product_type_code || !v.product_type_code || v.product_type_code === shipment.product_type_code)`.
  - `ExportFirmSelect` / `ShipmentFirmSelector`: new optional prop `productType?: string` (default `'tomato'`), passed by callers that have the shipment.
  - `shipmentEditConfig`: `| 'productTypes'` in `OptionsSource`; goods: `{ key: 'product_type', labelKey: 'sheet.row.product_type', inputType: 'select', optionsSource: 'productTypes' }` after `variety`.
  - `FieldEditor`: `case 'productTypes': return (productTypes ?? []).filter((p) => p.code).map((p) => ({ value: p.id, label: p.name }));`
  - Create form: `<Form.Item name="product_type" label={t('sheet.row.product_type')} initialValue={tomatoId}>` with a `Select` from `useProductTypes()`; `tomatoId = productTypes?.find((p) => p.code === 'tomato')?.id`.
  - Error toasts: where Sheet/Detail show `error` from a 400, map `'mixed_product'`/`'product_mismatch'` through `t(`errors.${code}`)` (find the shared API-error→toast helper; extend it once, not per call site).
  - i18n ru: `errors.mixed_product` «В одной фуре нельзя смешивать томат и перец», `errors.product_mismatch` «Продукт блоков не совпадает с продуктом рейса»; en/tk equivalents.
- [ ] **Step 4: Run** `npx vitest run src/components/sheet src/components/shipment` → PASS; tsc → no new errors.
- [ ] **Step 5: Commit (only on "commit")** — `feat(frontend): shipment product on the Sheet, Detail and create form`.

---

### Task 11: Frontend — weekly plan per-product totals

**Files:**
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.rows.ts` (`IPlanGridRow.product_code`)
- Modify: `frontend/src/pages/export/WeeklyPlanGrid.tsx` (`renderSummary` → one row per product; product tag beside block code)
- Test: extend `frontend/src/pages/export/WeeklyPlanGrid.rows.test.ts`; new `frontend/src/pages/export/WeeklyPlanGrid.productTotals.test.ts`

**Interfaces:** Consumes `IGreenhouseBlock.product_type_code` (Task 2).
Produces: `export function productTotals(rows: IPlanGridRow[], valueOf: (row: IPlanGridRow) => number): { code: string; total: number }[]` in `WeeklyPlanGrid.rows.ts` — ordered tomato, pepper, then others; rows with `product_code` null count as tomato.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { productTotals, type IPlanGridRow } from './WeeklyPlanGrid.rows';

const row = (block: number, product_code: string | null) => ({ block, product_code }) as unknown as IPlanGridRow;

describe('productTotals', () => {
  it('sums per product, null counts as tomato, tomato first', () => {
    const rows = [row(1, 'pepper'), row(2, 'tomato'), row(3, null)];
    const kg: Record<number, number> = { 1: 100, 2: 200, 3: 50 };
    expect(productTotals(rows, (r) => kg[r.block])).toEqual([
      { code: 'tomato', total: 250 },
      { code: 'pepper', total: 100 },
    ]);
  });
  it('one product only → one entry', () => {
    expect(productTotals([row(1, 'tomato')], () => 10)).toEqual([{ code: 'tomato', total: 10 }]);
  });
});
```

Plus in `WeeklyPlanGrid.rows.test.ts`: `buildPlanGridRows` copies `block.product_type_code` into `product_code`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - `IPlanGridRow`: `/** Block's product (tomato/pepper); null = no variety set. */ product_code: string | null;` — set in `buildPlanGridRows` from `block.product_type_code ?? null`.
  - `productTotals`:

```ts
export function productTotals(
  rows: IPlanGridRow[],
  valueOf: (row: IPlanGridRow) => number,
): { code: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const code = r.product_code ?? 'tomato';
    totals.set(code, (totals.get(code) ?? 0) + valueOf(r));
  }
  const rank = (c: string) => (c === 'tomato' ? 0 : c === 'pepper' ? 1 : 2);
  return [...totals.entries()]
    .map(([code, total]) => ({ code, total }))
    .sort((a, b) => rank(a.code) - rank(b.code));
}
```

  - `renderSummary`: compute the product list once from `productTotals(rows, () => 0)` codes; render one `Table.Summary.Row` per code, label `` `${t('plan.total')} ${t(`product.${code}`)}` ``, each day cell `productTotals(rows.filter(...), …)` — simplest: for each code, `rows.filter((r) => (r.product_code ?? 'tomato') === code)` then the existing per-day reduce. When only one product is present, the label stays plain `t('plan.total')` (no change for an all-tomato week).
  - Block column: after the code, `{r.product_code === 'pepper' && <Tag color="red" style={{ marginInlineStart: 4 }}>{t('product.pepper')}</Tag>}` (only pepper gets a tag — tomato is the default and would be noise).
  - `renderTransposedSummary`: unchanged (spec §6).
- [ ] **Step 4: Run** `npx vitest run src/pages/export/WeeklyPlanGrid` → PASS; tsc clean.
- [ ] **Step 5: Commit (only on "commit")** — `feat(frontend): weekly plan totals per product`.

---

### Task 12: Frontend — contract product select

**Files:**
- Modify: `frontend/src/pages/contracts/ContractCreate.tsx` (+ `product_type` field, default tomato)
- Modify: `frontend/src/pages/contracts/ContractList.tsx`, `ContractDetail.tsx` (show product)
- Modify: contract types in `frontend/src/types/index.ts` (+`product_type`, `product_type_code`)
- Modify: `frontend/src/pages/contracts/ContractCreate.test.tsx`

**Interfaces:** Consumes `useProductTypes()`; contract API from Task 7.

- [ ] **Step 1: Failing test** — in `ContractCreate.test.tsx`, mock `useProductTypes` (tomato id 1, pepper id 2); submit the form with pepper chosen; assert the POST payload contains `product_type: 2`; and when untouched, `product_type: 1`.
- [ ] **Step 2: Run** `npx vitest run src/pages/contracts/ContractCreate.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — `IContractCreateValues.product_type: number | null`; `<Form.Item name="product_type" label={t('contracts.create.field.product')} initialValue={tomatoId}><Select options={...} /></Form.Item>` next to incoterm; include `product_type: values.product_type` in the payload builder (L74 pattern). List: a column `t('contracts.list.col.product')` rendering `t(`product.${r.product_type_code ?? 'tomato'}`)`. Detail: same in its descriptions block. i18n keys in en/ru/tk.
- [ ] **Step 4: Run** → PASS; `npx vitest run src/pages/contracts` → PASS; tsc clean.
- [ ] **Step 5: Commit (only on "commit")** — `feat(frontend): contracts choose a product`.

---

### Task 13: Docs, changelog, test log

**Files:**
- Modify: `docs/obsidian/` — find the notes via `docs/obsidian/00-index.md`: reference data (product types, varieties), quota, document generation, weekly plan, Sheet rows, contracts, `reference/api-endpoint-map.md`
- Modify: `.claude/skills/api-contract/SKILL.md` — `/core/product-types/`; `product_type_code` on blocks/varieties; `product_type`/`product_type_code`/`product_type_name` on shipments + `?product_type=` filter; `product_type` on contracts; new 400 codes
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added/Changed/Data lines)
- Modify: `BUILD_TEST_LOG.md` (top): `- [ ] 2026-10-05 — Pepper as a second product (product field, quota, documents, contracts, weekly-plan totals, admin) — NEEDS TEST`
- Modify: `docs/superpowers/specs/2026-10-05-pepper-product-design.md` status → `implemented`

- [ ] **Step 1:** Write the doc updates (one short paragraph or table row each; no new notes unless the index has no home for product types — then add `docs/obsidian/reference/product-types.md` and link it from the index).
- [ ] **Step 2:** Full backend run of touched apps: `TEST_DB_NAME=test_pepper_all python manage.py test apps.core apps.export apps.contracts --noinput --verbosity=1`; compare failures with memory `project_beta_test_suite_failures` (pre-existing buckets) and report new ones honestly.
- [ ] **Step 3:** `cd frontend && npx vitest run && npx tsc --noEmit --ignoreDeprecations 5.0`.
- [ ] **Step 4: Commit (only on "commit")** — `docs: pepper product — spec, plan, vault, api contract, changelog, test log`.

## Deploy notes (for the user, not a task)

- Beta: `update.sh` then `migrate core export contracts` — 0073/0074 (core), 0097/0098 (export), 0018/0019 (contracts). All additive and nullable; old beta code keeps working on the same DB.
- After migrate, D/G/M5 carry pepper varieties; new supply rows from them are pepper.
- Pepper firms need pepper `QuotaIssuance` rows, or a pepper truck's firm split is refused ("no remaining quota").
- Pepper framework contracts must be created (product «Bolgar burç») before linking pepper trucks in framework mode.
