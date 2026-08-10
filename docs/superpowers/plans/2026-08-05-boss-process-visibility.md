# Boss Process Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the boss follow and act on the whole export process from his own login, without logging in as each role.

**Architecture:** Three independent changes. (1) The sidebar's one global group array is reordered into process phases and five orphaned pages are added to it. (2) The `boss` role's seeded page/resource/field permission defaults are widened from read-only-on-3-pages to full access. (3) `boss` joins `PRIVILEGED_ROLES` so `transition_to()` accepts him, and a header toggle makes the frontend treat him as read-only until he explicitly opts into editing.

**Tech Stack:** Django 5 / DRF / MSSQL, React 18 + TypeScript + Ant Design 5, Zustand, vitest, react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-05-boss-process-visibility-design.md`

## Global Constraints

- **Never commit without the user saying "commit".** Each task below ends with a commit step; run it only when the user has approved that task.
- **One commit = one logical unit.** Do not bundle tasks.
- **You are working in the worktree `D:\projects\yigit_platform-boss-visibility` on branch `feat/boss-process-visibility`.** Another session is actively committing to `feat/season-lifecycle` in the sibling checkout — never touch that directory.
- **Backend tests run against a local MSSQL test database, not SQLite.** Always prefix with an isolated database name so a concurrent session's test run cannot collide:
  ```
  TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test <target> --noinput
  ```
  Without `TEST_DB_NAME` you share `test_YIGIT_PLATFROM` with the other session. Without `--noinput` Django blocks on an interactive "destroy the existing test database?" prompt and dies with `EOFError`.
- **Known pre-existing failure, not yours:** `apps.core.tests_permission_matrix` has one error — `ModuleNotFoundError: No module named 'apps.core.migrations.0016_demote_existing_director'` (the test at line 330 imports a migration that was collapsed away). Baseline for that module is 22 pass / 1 error. Do not fix it; do not count it as a regression.
- Frontend baseline in this worktree is **121 tests / 16 files, all passing**. Frontend type-check: `npx tsc --noEmit --ignoreDeprecations 5.0` (the `npm run type-check` script is broken with TS5103).
- `backend/.env` and `frontend/.env` are untracked and were copied into this worktree during setup. Do not commit them.
- **i18n is STRICT.** Every new user-visible string needs a key in all three of `frontend/src/i18n/tk.json`, `ru.json`, `en.json`. Never hardcode a string in JSX. Never add a key to one file only. Never use one language as a placeholder for another.
- **Status changes go only through `transition_to()`.** Never write `shipment.status_id` directly.
- MSSQL: no `JSONField`, no `ArrayField`, no `.distinct('field')`, `bulk_create(batch_size=500)`.
- Frontend interfaces are `I`-prefixed; handlers are `handle`-prefixed; booleans are `is`/`has`/`can`-prefixed.
- **Stage only the files each task names.** `git add .` is forbidden — the worktree carries copied `.env` files and a git-ignored `.superpowers/` scratch directory.

---

### Task 1: Boss permission defaults

Widens the `boss` role from 3 read-only pages to every page with full CRUD. Pure configuration — no new models, no migration.

**Files:**
- Modify: `backend/apps/core/management/commands/seed_permissions.py` (three dict entries)
- Test: `backend/apps/core/tests_boss_access.py` (create)

**Interfaces:**
- Consumes: `_ALL_PAGES` (line 28) and `_ALL_RESOURCES` (line 151), both already defined in `seed_permissions.py`; `_VCRUD` (line 146).
- Produces: after `call_command('seed_permissions')`, the `boss` role has one `RolePagePermission` row per registered page with `is_visible=True`, `RoleResourcePermission` rows with all four flags `True` for every resource, and `RoleFieldPermission` rows with `field_name='*'` per resource.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests_boss_access.py`:

```python
"""Boss role permission defaults (2026-08-05 boss-process-visibility).

The boss must see every registered page and hold full CRUD on every resource
so he can follow and act on the whole process from his own login. Before this
change he had 3 pages and view-only on everything.
"""
from django.core.management import call_command
from django.test import TestCase

from apps.core.models import (
    RoleFieldPermission,
    RolePagePermission,
    RoleResourcePermission,
)
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY


class BossPermissionDefaultsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def test_boss_sees_every_registered_page(self):
        visible = set(
            RolePagePermission.objects
            .filter(role='boss', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, set(PAGE_REGISTRY.keys()))

    def test_boss_has_full_crud_on_every_resource_except_closed_season(self):
        rows = RoleResourcePermission.objects.filter(role='boss')
        self.assertEqual(rows.count(), len(RESOURCE_REGISTRY))
        for row in rows.exclude(resource_code='closed_season'):
            with self.subTest(resource=row.resource_code):
                self.assertTrue(row.can_view)
                self.assertTrue(row.can_create)
                self.assertTrue(row.can_edit)
                self.assertTrue(row.can_delete)

    def test_closed_season_stays_read_only_for_boss(self):
        """D1: a closed season is read-only for everyone, admin included."""
        row = RoleResourcePermission.objects.get(role='boss', resource_code='closed_season')
        self.assertTrue(row.can_view)
        self.assertFalse(row.can_create)
        self.assertFalse(row.can_edit)
        self.assertFalse(row.can_delete)

    def test_boss_has_wildcard_field_access(self):
        fields = set(
            RoleFieldPermission.objects
            .filter(role='boss')
            .values_list('resource_code', 'field_name')
        )
        expected = {(r, '*') for r in RESOURCE_REGISTRY}
        self.assertEqual(fields, expected)

    def test_other_roles_are_untouched(self):
        """Regression guard: widening boss must not widen anyone else."""
        sales_pages = set(
            RolePagePermission.objects
            .filter(role='sales_rep', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertNotEqual(sales_pages, set(PAGE_REGISTRY.keys()))
        self.assertFalse(
            RoleResourcePermission.objects
            .filter(role='sales_rep', resource_code='season', can_delete=True)
            .exists()
        )
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.core.tests_boss_access -v 2 --noinput
```

Expected: three failures. `test_boss_sees_every_registered_page` fails because the visible set has 5 entries, not 42. `test_boss_has_full_crud_on_every_resource` fails on the first `assertTrue(row.can_create)`. `test_boss_has_wildcard_field_access` fails with an empty set on the left. `test_other_roles_are_untouched` passes already — that is correct, it is a guard.

- [ ] **Step 3: Widen the page defaults**

In `backend/apps/core/management/commands/seed_permissions.py`, replace the `boss` entry inside `PAGE_DEFAULTS` (currently at line 131):

```python
    # boss: every registered page. He owns the process end-to-end and must not
    # need to log in as another role to see a step (2026-08-05 design).
    # _UNIVERSAL is a subset of _ALL_PAGES, so nothing he had before is lost.
    # This deliberately includes admin.permissions — the boss can widen access
    # for himself and others. Approved 2026-08-05.
    'boss': set(_ALL_PAGES),
```

- [ ] **Step 4: Widen the resource defaults**

Replace the `boss` entry inside `RESOURCE_DEFAULTS` (currently at line 251):

```python
    # boss: full CRUD on every resource. The read-only guard now lives in the
    # frontend view/edit toggle, not in the permission matrix (2026-08-05).
    # EXCEPT closed_season — read-only by design (D1), same carve-out admin has.
    'boss': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        'closed_season': _VIEW,
    },
```

The stale comment on line ~250 ("the blanket `_VIEW` already gives closed_season the correct
read-only grant with no override") is now wrong — the override is explicit. Replace it with a
pointer to the carve-out above.

- [ ] **Step 5: Add the field defaults**

`FIELD_DEFAULTS` currently has no `boss` key. Without one, `canEditField()` returns `False` and every field renders locked. Add this line immediately after the `FIELD_DEFAULTS` dict literal closes — next to the existing `RESOURCE_DEFAULTS['loading_dept_head_deputy'] = ...` style of post-literal assignment:

```python
# boss: wildcard on every resource. Uses a comprehension rather than admin's
# hand-enumerated list so a newly registered resource is covered automatically.
FIELD_DEFAULTS['boss'] = {r: ['*'] for r in _ALL_RESOURCES}
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.core.tests_boss_access -v 2 --noinput
```

Expected: 4 tests, all PASS.

- [ ] **Step 7: Run the surrounding suites for regressions**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.core apps.export -v 1 --noinput
```

Expected: no *new* failures relative to the 1404 pass / 71 fail baseline. If a test that names another role now fails, that is a real regression — stop and report it.

- [ ] **Step 8: Apply the seed to the dev database**

**Plain `seed_permissions` will silently do nothing here.** `_seed_page_permissions()` (line 494)
loops over *all* of `PAGE_REGISTRY` for every role and uses `get_or_create(..., defaults={...})` —
`defaults` applies only on insert. Boss already has 42 page rows; the 39 he cannot see exist with
`is_visible=False`. Re-running finds them and changes nothing. The test suite cannot catch this,
because `call_command` on a fresh test DB creates every row from scratch.

`--reset` exists but wipes the matrix for **every** role, discarding any manual edits made through
`/admin/permissions`. Delete only the boss rows instead, then re-seed:

```bash
cd backend && python manage.py shell -c "
from apps.core.models import RolePagePermission, RoleResourcePermission, RoleFieldPermission
print('deleted', RolePagePermission.objects.filter(role='boss').delete())
print('deleted', RoleResourcePermission.objects.filter(role='boss').delete())
print('deleted', RoleFieldPermission.objects.filter(role='boss').delete())
"
cd backend && python manage.py seed_permissions
```

`seed_permissions` invalidates the 60-second per-role permission cache on the way out, so the new
grants take effect immediately.

Then confirm:

```bash
cd backend && python manage.py shell -c "
from apps.core.models import RolePagePermission, RoleResourcePermission
from apps.core.permission_registry import PAGE_REGISTRY
print('visible pages:', RolePagePermission.objects.filter(role='boss', is_visible=True).count(), 'of', len(PAGE_REGISTRY))
print('editable resources:', RoleResourcePermission.objects.filter(role='boss', can_edit=True).count())
"
```

Expected: `visible pages: 42 of 42` and `editable resources` one less than the resource-registry
size (`closed_season` is the carve-out). If visible pages prints a single-digit number, the delete
step did not run — do not proceed.

- [ ] **Step 9: Commit** (only after the user says "commit")

```bash
git add backend/apps/core/management/commands/seed_permissions.py backend/apps/core/tests_boss_access.py
git commit -m "feat(core): grant boss full page/resource/field permissions"
```

---

### Task 2: Boss can trigger status transitions

`transition_to()` is the only path that may change a shipment's status, and it rejects any role not owning the specific transition edge unless the role is privileged. `boss` is not privileged today, so full CRUD alone would still leave him unable to move a truck.

**Files:**
- Modify: `backend/apps/export/services/shipment.py:41`
- Test: `backend/apps/export/tests_boss_transitions.py` (create)

**Interfaces:**
- Consumes: `transition_to(shipment, new_status_code, user, comment='', is_auto=False, notify=True)` from `apps.export.services`.
- Produces: `PRIVILEGED_ROLES` in `apps/export/services/shipment.py` becomes `{'export_manager', 'director', 'boss'}`.

**Do not touch** `apps/core/roles.py:54`. A second `PRIVILEGED_ROLES` lives there with different membership (`admin`, `export_manager`, `director`). The two are already divergent; reconciling them is out of scope and would change unrelated behaviour.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_boss_transitions.py`:

```python
"""Boss can drive the shipment state machine (2026-08-05 boss-process-visibility).

`transition_to()` gates each edge on the role that owns it, unless the actor's
role is in PRIVILEGED_ROLES. The boss must be able to unstick any step without
logging in as the owning role — but a closed season must still stay frozen.
"""
from django.test import TestCase

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    ShipmentStatusType,
    User,
)
from apps.core.models import Season
from apps.core.seasons import SeasonClosedError
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services import transition_to


def _create_all_statuses():
    """State machine v2 status types (12 active + 3 retired)."""
    statuses = [
        ('draft',           0,  'DRAFT',    True),
        ('gumruk_girish',   1,  'CUSTOMS',  True),
        ('gumruk_chykysh',  2,  'CUSTOMS',  True),
        ('yuklenme',        3,  'LOADING',  True),
        ('yola_chykdy',     4,  'TRANSIT',  True),
        ('serhet_gechdi',   5,  'BORDER',   True),
        ('dest_entry',      6,  'BORDER',   True),
        ('barysh_gumrugi',  7,  'BORDER',   True),
        ('transshipment',   8,  'SALES',    True),
        ('bardy',           9,  'SALES',    True),
        ('satylyar',       10,  'SALES',    True),
        ('satyldy',        11,  'SALES',    True),
        ('tamamlandy',     12,  'COMPLETE', True),
        ('serhet_tm',     100,  'BORDER',   False),
        ('yolda',         101,  'TRANSIT',  False),
        ('hasabat',       102,  'COMPLETE', False),
    ]
    for code, order, phase, is_active in statuses:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk':    code,
                'name_en':    code,
                'step_order': order,
                'phase':      phase,
                'is_active':  is_active,
            },
        )


class BossTransitionTests(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        self.boss = User.objects.create_user(
            username='bossuser', password='pass', role='boss'
        )
        _create_all_statuses()
        draft = ShipmentStatusType.objects.get(code='draft')
        self.country = Country.objects.create(
            name_tk='KZ', name_en='KZ', name_ru='KZ', code='KZ'
        )
        self.customer = Customer.objects.create(name='TestCustomer-Boss')
        self.block = GreenhouseBlock.objects.create(code='F-B1', name='Test block B1')
        self.shipment = Shipment.objects.create(
            shipment_code='BOSS-001',
            date='2025-11-01',
            season=self.season,
            status=draft,
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )
        # transition_to()'s draft-leave guard needs both halves of the two-row flow.
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=10000,
        )

    def test_boss_may_trigger_a_transition_owned_by_another_role(self):
        """draft -> gumruk_girish is document_team's edge. Boss must pass."""
        transition_to(self.shipment, 'gumruk_girish', self.boss)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_boss_still_cannot_skip_steps(self):
        """Privilege bypasses the ROLE check, never the state machine itself."""
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'tamamlandy', self.boss)

    def test_boss_cannot_write_to_a_closed_season(self):
        """D1 write freeze outranks privilege."""
        self.season.is_closed = True
        self.season.save(update_fields=['is_closed'])
        with self.assertRaises(SeasonClosedError):
            transition_to(self.shipment, 'gumruk_girish', self.boss)
```

Before running, confirm two import paths against the current tree, because both have moved before: `Season`'s module (`apps.core.models`) and `SeasonClosedError`'s module (`apps.core.seasons`). Also confirm the field that marks a season closed — `grep -n "is_closed\|status" backend/apps/core/models/season.py`. If it is not a boolean `is_closed`, set whatever field `assert_season_open()` actually reads and keep the assertion identical.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.export.tests_boss_transitions -v 2 --noinput
```

Expected: `test_boss_may_trigger_a_transition_owned_by_another_role` FAILS with `PermissionError: Role 'boss' cannot trigger transition to 'gumruk_girish'`. The other two PASS already — they are guards proving the change does not over-reach.

- [ ] **Step 3: Add boss to the privileged set**

In `backend/apps/export/services/shipment.py`, line 41:

```python
# Roles that bypass the per-edge role check. boss joined 2026-08-05 so he can
# unstick any step from his own login instead of logging in as each role.
# NOTE: apps/core/roles.py has a same-named constant with different members.
# They are already divergent — do not "fix" that here.
PRIVILEGED_ROLES = {'export_manager', 'director', 'boss'}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.export.tests_boss_transitions -v 2 --noinput
```

Expected: 3 tests, all PASS.

- [ ] **Step 5: Run the export suite for regressions**

```bash
cd backend && TEST_DB_NAME=test_YIGIT_BOSS DJANGO_TESTING=true python manage.py test apps.export -v 1 --noinput
```

Expected: no new failures against the baseline. Pay attention to any test asserting that a non-privileged role is rejected — none of them use `boss`, so none should flip.

- [ ] **Step 6: Commit** (only after the user says "commit")

```bash
git add backend/apps/export/services/shipment.py backend/apps/export/tests_boss_transitions.py
git commit -m "feat(export): let boss trigger any valid status transition"
```

---

### Task 3: Sidebar reordered by process

`allMenuGroups` is one global array; the filter at lines 301–320 decides visibility only and never reorders. Groups with no visible children collapse away (line 313), so each role automatically sees its own slice of the process order.

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx:166-298`
- Modify: `frontend/src/i18n/tk.json`, `frontend/src/i18n/ru.json`, `frontend/src/i18n/en.json`

**Interfaces:**
- Consumes: `canSeePage(user, item.key)` from `@/utils/permissions`; `ROUTE_PAGE_MAP` already maps all five newly-added routes, so no permissions change is needed for them.
- Produces: no exported symbols change. `MenuItem` keeps its `{ key, icon, label, roles? }` shape.

Verified before writing this task: all five new items' label keys (`nav.trucks`, `nav.drafts`, `nav.assign`, `nav.domestic_sales`, `nav.prices`) **already exist in all three locale files**. Only the eight new group labels need adding.

- [ ] **Step 1: Add the eight new group keys to all three locale files**

In each of `frontend/src/i18n/tk.json`, `ru.json`, `en.json`, inside the existing `"nav"` object, add:

```json
"group_overview": "...",
"group_planning": "...",
"group_prep": "...",
"group_shipping": "...",
"group_docs": "...",
"group_sales": "...",
"group_finance": "...",
"group_reference": "..."
```

Values:

| key | tk | ru | en |
|---|---|---|---|
| `group_overview` | `Syn` | `Обзор` | `Overview` |
| `group_planning` | `1. Meýilnama` | `1. Планирование` | `1. Planning` |
| `group_prep` | `2. Taýýarlyk` | `2. Подготовка` | `2. Preparation` |
| `group_shipping` | `3. Ýükleme` | `3. Отгрузка` | `3. Shipping` |
| `group_docs` | `4. Resminamalar we gümrük` | `4. Документы и таможня` | `4. Documents & Customs` |
| `group_sales` | `5. Satuw we şertnamalar` | `5. Продажа и контракты` | `5. Sales & Contracts` |
| `group_finance` | `6. Maliýe` | `6. Финансы` | `6. Finance` |
| `group_reference` | `Sözlükler` | `Справочники` | `Reference data` |

The existing `nav.group_analytics`, `nav.group_system` and `nav.group_feedback` keys are reused unchanged. `nav.group_main`, `nav.group_export`, `nav.group_contracts`, `nav.group_management`, `nav.group_team` become unused — leave them in the JSON files rather than deleting, so no other consumer breaks silently.

- [ ] **Step 2: Verify every key resolves in all three locales**

```bash
cd frontend && python -c "
import json
keys=['group_overview','group_planning','group_prep','group_shipping','group_docs','group_sales','group_finance','group_reference','group_analytics','group_system','group_feedback','trucks','drafts','assign','domestic_sales','prices']
for loc in ['tk','ru','en']:
    nav=json.load(open(f'src/i18n/{loc}.json',encoding='utf-8')).get('nav',{})
    missing=[k for k in keys if k not in nav]
    print(loc,'missing:',missing)
"
```

Expected: `missing: []` for all three. If not, add the missing key before continuing — do not proceed with a hardcoded string.

- [ ] **Step 3: Replace the group array**

In `frontend/src/components/AppLayout.tsx`, replace the whole `allMenuGroups` literal (lines 166–298) with the following. Every existing item keeps its exact `key`, `icon` and `label`; only grouping and order change, plus five additions marked `NEW`. The two `roles: [...]` arrays on `/worklog` and `/team/kpi` must be carried over verbatim — they bypass `canSeePage` and dropping them would hide those pages from everyone.

```tsx
  const allMenuGroups: { label: string; items: MenuItem[] }[] = [
    // Groups 1..6 are the export process in order. Unnumbered groups support it.
    // One global order for every role; the filter below hides items a role
    // cannot see, and a group with no visible children collapses (see line ~313).
    { label: t('nav.group_overview'), items: [
      { key: '/', icon: <IconLayoutDashboard size={15} />, label: t('nav.dashboard') },
      { key: '/boss/dashboard', icon: <IconChartPie size={15} />, label: t('nav.boss_dashboard') },
      {
        key: '/me/board',
        icon: (
          <Badge count={myOpenCount} size="small" offset={[8, -2]}>
            <IconClipboardList size={15} />
          </Badge>
        ),
        label: t('me.nav.board'),
      },
      {
        key: '/director/stuck-shipments',
        icon: <IconAlertTriangle size={15} />,
        label: t('nav.stuck_shipments'),
      },
    ]},
    { label: t('nav.group_planning'), items: [
      { key: '/export/plan', icon: <IconCalendar size={15} />, label: t('nav.plan') },
      { key: '/export/harvest-board', icon: <IconPlant2 size={15} />, label: t('nav.harvest_board') },
      { key: '/export/trucks', icon: <IconTruck size={15} />, label: t('nav.trucks') },          // NEW
      { key: '/export/quota', icon: <IconChartPie size={15} />, label: t('nav.quota') },
      { key: '/export/blocks', icon: <IconChartBar size={15} />, label: t('nav.block_summary') },
    ]},
    { label: t('nav.group_prep'), items: [
      { key: '/export/drafts', icon: <IconLayoutGrid size={15} />, label: t('nav.drafts') },     // NEW
      { key: '/export/assign', icon: <IconLayoutKanban size={15} />, label: t('nav.assign') },   // NEW
      { key: '/export/weightmaster', icon: <IconScale size={15} />, label: t('nav.weightmaster') },
    ]},
    { label: t('nav.group_shipping'), items: [
      { key: '/export/shipments', icon: <IconTruck size={15} />, label: t('nav.shipments') },
      { key: '/export/shipments/sheet', icon: <IconLayoutGrid size={15} />, label: t('nav.shipment_sheet') },
      { key: '/export/shipments/board', icon: <IconLayoutKanban size={15} />, label: t('nav.shipment_board') },
      { key: '/export/shipments/dashboard', icon: <IconLayoutDashboard size={15} />, label: t('nav.shipment_dashboard') },
    ]},
    { label: t('nav.group_docs'), items: [
      { key: '/documents', icon: <IconFileText size={15} />, label: t('nav.documents') },
      { key: '/admin/packing-templates', icon: <IconFileText size={15} />, label: t('nav.admin_packing_templates') },
    ]},
    { label: t('nav.group_sales'), items: [
      { key: '/contracts', icon: <IconFileText size={15} />, label: t('nav.contracts.list') },
      { key: '/sales', icon: <IconFileText size={15} />, label: t('nav.sales.list') },
      { key: '/export/my-reports', icon: <IconReportAnalytics size={15} />, label: t('nav.sales_reports') },
      { key: '/export/domestic-sales', icon: <IconBuildingWarehouse size={15} />, label: t('nav.domestic_sales') },  // NEW
      { key: '/export/prices', icon: <IconChartBar size={15} />, label: t('nav.prices') },       // NEW
    ]},
    { label: t('nav.group_finance'), items: [
      { key: '/export/advances', icon: <IconBuildingBank size={15} />, label: t('nav.advances') },
      { key: '/export/overdue', icon: <IconAlertTriangle size={15} />, label: t('nav.overdue') },
      { key: '/admin/expense-template', icon: <IconFileText size={15} />, label: t('nav.admin_expense_template') },
    ]},
    { label: t('nav.group_analytics'), items: [
      { key: '/analytics/clients-report', icon: <IconUsers size={15} />, label: t('nav.clients_report') },
      {
        key: '/team/kpi',
        icon: <IconTrophy size={15} />,
        label: t('nav.team_kpi'),
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
          'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
      {
        key: '/worklog',
        icon: <IconClock size={15} />,
        label: t('nav.worklog'),
        // Radical transparency: every authenticated user sees this page. No
        // page_code is registered for it, so it is surfaced via an explicit
        // roles list that bypasses canSeePage.
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
          'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
    ]},
    { label: t('nav.group_reference'), items: [
      { key: '/admin/seasons', icon: <IconCalendar size={15} />, label: t('nav.admin_seasons') },
      { key: '/admin/firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_firms') },
      { key: '/admin/import-firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_import_firms') },
      { key: '/admin/customers', icon: <IconUser size={15} />, label: t('nav.admin_customers') },
      { key: '/admin/blocks', icon: <IconBuildingWarehouse size={15} />, label: t('nav.admin_blocks') },
      { key: '/admin/truck-destinations', icon: <IconTruck size={15} />, label: t('nav.admin_truck_dest') },
    ]},
    { label: t('nav.group_system'), items: [
      { key: '/admin/users', icon: <IconUsers size={15} />, label: t('nav.admin_users') },
      { key: '/admin/permissions', icon: <IconShield size={15} />, label: t('nav.admin_permissions') },
      { key: '/admin/staff-access', icon: <IconUsers size={15} />, label: t('nav.admin_staff_access') },
      { key: '/admin/shipment-settings', icon: <IconLayoutGrid size={15} />, label: t('nav.admin_shipment_settings') },
      { key: '/admin/sales-rep-coverage', icon: <IconMapPin size={15} />, label: t('nav.sales_rep_coverage') },
      {
        key: '/admin/audit-log',
        icon: <IconClipboardList size={15} />,
        label: t('nav.admin_audit_log'),
      },
    ]},
    { label: t('nav.group_feedback'), items: [
      { key: '/feedback/submit', icon: <IconMessageCircle size={15} />, label: t('nav.feedback_submit') },
      { key: '/feedback/my-tickets', icon: <IconFileText size={15} />, label: t('nav.feedback_my_tickets') },
      { key: '/feedback/public', icon: <IconChartPie size={15} />, label: t('nav.feedback_public') },
      {
        key: '/admin/feedback',
        icon: (
          <Badge count={feedbackUnreadCount} size="small" offset={[6, 0]}>
            <IconInbox size={15} />
          </Badge>
        ),
        label: t('nav.feedback_admin_inbox'),
      },
    ]},
  ];
```

- [ ] **Step 4: Verify no menu item was lost**

```bash
cd frontend && node -e "
const s=require('fs').readFileSync('src/components/AppLayout.tsx','utf8');
const body=s.slice(s.indexOf('const allMenuGroups'), s.indexOf('// Filter: keep only items'));
const keys=[...body.matchAll(/key: '([^']+)'/g)].map(m=>m[1]);
console.log('items:',keys.length);
console.log('duplicates:',keys.filter((k,i)=>keys.indexOf(k)!==i));
"
```

Expected: `items: 45`, `duplicates: []`. The array had **40** items before this change (counted, not estimated); five were added, none removed. A duplicate key would make Ant Design render two identical menu entries and break selection highlighting.

- [ ] **Step 5: Type-check**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors. If an icon used above is not imported at the top of `AppLayout.tsx`, add it to the existing `@tabler/icons-react` import — every icon named here (`IconLayoutDashboard`, `IconChartPie`, `IconClipboardList`, `IconAlertTriangle`, `IconCalendar`, `IconPlant2`, `IconTruck`, `IconChartBar`, `IconLayoutGrid`, `IconLayoutKanban`, `IconScale`, `IconFileText`, `IconReportAnalytics`, `IconBuildingWarehouse`, `IconBuildingBank`, `IconUsers`, `IconUser`, `IconTrophy`, `IconClock`, `IconShield`, `IconMapPin`, `IconMessageCircle`, `IconInbox`) was already in use before this change, so this should be a no-op.

- [ ] **Step 6: Verify in the browser**

Start the dev server, log in as a boss account, and confirm the sidebar reads
`Обзор → 1. Планирование → 2. Подготовка → 3. Отгрузка → 4. Документы и таможня → 5. Продажа и контракты → 6. Финансы → Аналитика → Справочники → Система → Обратная связь`.
Then log in as a `loading_dept_head` and confirm most groups have collapsed away and the remaining ones are still in that relative order.

- [ ] **Step 7: Commit** (only after the user says "commit")

```bash
git add frontend/src/components/AppLayout.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): reorder sidebar by export process, surface 5 orphaned pages"
```

---

### Task 4: Boss edit-mode store and permission guards

The state and the two guards. The visible control comes in Task 5, so this task ships a switch nobody can flip yet — that is intentional: it is independently testable, and Task 5 becomes a pure UI change.

**Files:**
- Modify: `frontend/src/stores/uiStore.ts`
- Modify: `frontend/src/utils/permissions.ts:97-126`
- Test: `frontend/src/utils/permissions.bossEditMode.test.ts` (create)

**Interfaces:**
- Produces: `useUiStore` gains `bossEditMode: boolean` (default `false`) and `setBossEditMode: (val: boolean) => void`. Task 5 consumes both.
- `canDo` and `canEditField` keep their existing signatures unchanged.

Not persisted: `uiStore` is a plain `create()` with no `persist` middleware, and adding one solely for this would be the wrong trade. Resetting to view mode on reload is the safer default.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/permissions.bossEditMode.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { canDo, canEditField } from './permissions';
import { useUiStore } from '@/stores/uiStore';
import type { ICurrentUser } from '@/types';

const bossUser = {
  role: 'boss',
  is_superuser: false,
  page_permissions: {},
  resource_permissions: { shipment: { view: true, create: true, edit: true, delete: true } },
  field_permissions: { shipment: ['*'] },
} as unknown as ICurrentUser;

const bossSuperuser = { ...bossUser, is_superuser: true } as ICurrentUser;

const managerUser = {
  role: 'export_manager',
  is_superuser: false,
  page_permissions: {},
  resource_permissions: { shipment: { view: true, create: true, edit: true, delete: true } },
  field_permissions: { shipment: ['*'] },
} as unknown as ICurrentUser;

describe('boss edit mode gate', () => {
  beforeEach(() => {
    useUiStore.setState({ bossEditMode: false });
  });

  it('blocks boss edits while in view mode', () => {
    expect(canDo(bossUser, 'shipment', 'edit')).toBe(false);
    expect(canDo(bossUser, 'shipment', 'delete')).toBe(false);
    expect(canEditField(bossUser, 'shipment', 'weight_net')).toBe(false);
  });

  it('still allows boss to view in view mode', () => {
    // 'view' is exempt from the guard. Locking reads would blank the whole
    // process for him, which is the opposite of what this feature is for.
    expect(canDo(bossUser, 'shipment', 'view')).toBe(true);
  });

  it('allows boss edits once edit mode is on', () => {
    useUiStore.setState({ bossEditMode: true });
    expect(canDo(bossUser, 'shipment', 'edit')).toBe(true);
    expect(canEditField(bossUser, 'shipment', 'weight_net')).toBe(true);
  });

  it('gates a boss who is also a superuser', () => {
    // The guard must sit ABOVE the is_superuser short-circuit, or the
    // toggle silently does nothing for superuser boss accounts.
    expect(canDo(bossSuperuser, 'shipment', 'edit')).toBe(false);
    expect(canEditField(bossSuperuser, 'shipment', 'weight_net')).toBe(false);
  });

  it('never affects other roles', () => {
    expect(canDo(managerUser, 'shipment', 'edit')).toBe(true);
    expect(canEditField(managerUser, 'shipment', 'weight_net')).toBe(true);
    useUiStore.setState({ bossEditMode: true });
    expect(canDo(managerUser, 'shipment', 'edit')).toBe(true);
  });

  it('defaults to view mode', () => {
    useUiStore.setState({ bossEditMode: undefined as unknown as boolean });
    expect(useUiStore.getState().bossEditMode).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd frontend && npx vitest run src/utils/permissions.bossEditMode.test.ts
```

Expected: FAIL. The first test fails because `canDo` currently returns `true` for boss edits; TypeScript will also flag `bossEditMode` as not existing on `IUiState`.

- [ ] **Step 3: Add the state**

In `frontend/src/stores/uiStore.ts`:

```ts
import { create } from 'zustand';

interface IUiState {
  planPivotMode: boolean;
  setPlanPivotMode: (val: boolean) => void;
  // Sunday is rarely used and widens the weekly-plan grid, so it's hidden by
  // default and revealed on demand via a toolbar toggle.
  planShowSunday: boolean;
  setPlanShowSunday: (val: boolean) => void;
  // Boss view/edit toggle (2026-08-05). The boss holds full CRUD in the
  // permission matrix, so this guards against accidental edits while he browses
  // the process. Deliberately NOT persisted — every session starts read-only.
  // This is a UI guard, not a security boundary: the backend accepts boss
  // writes in both positions.
  bossEditMode: boolean;
  setBossEditMode: (val: boolean) => void;
}

export const useUiStore = create<IUiState>((set) => ({
  planPivotMode: false,
  setPlanPivotMode: (val) => set({ planPivotMode: val }),
  planShowSunday: false,
  setPlanShowSunday: (val) => set({ planShowSunday: val }),
  bossEditMode: false,
  setBossEditMode: (val) => set({ bossEditMode: val }),
}));
```

- [ ] **Step 4: Add the guards**

In `frontend/src/utils/permissions.ts`, add the import at the top with the other project imports:

```ts
import { useUiStore } from '@/stores/uiStore';
```

Then add one guard to each function. **The guard must sit above the `is_superuser` short-circuit** — a boss account that is also a superuser would otherwise skip it entirely.

```ts
export function canDo(
  user: ICurrentUser | null,
  resource: string,
  action: 'view' | 'create' | 'edit' | 'delete',
): boolean {
  if (!user) return false;
  // Boss view/edit toggle. MUST precede the is_superuser check below.
  // 'view' is exempt — locking reads would blank the process for him.
  if (user.role === 'boss' && action !== 'view' && !useUiStore.getState().bossEditMode) {
    return false;
  }
  if (user.is_superuser) return true;

  const perm = user.resource_permissions?.[resource];
  if (!perm) return false;

  return perm[action] ?? false;
}

export function canEditField(
  user: ICurrentUser | null,
  resource: string,
  fieldName: string,
): boolean {
  if (!user) return false;
  // Boss view/edit toggle. MUST precede the is_superuser check below.
  if (user.role === 'boss' && !useUiStore.getState().bossEditMode) return false;
  if (user.is_superuser) return true;

  const fields = user.field_permissions?.[resource];
  if (!fields || fields.length === 0) return false;

  return fields.includes('*') || fields.includes(fieldName);
}
```

`canSeePage` is deliberately left alone — the toggle must never hide pages, only lock edits.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
cd frontend && npx vitest run src/utils/permissions.bossEditMode.test.ts
```

Expected: 6 tests, all PASS.

- [ ] **Step 6: Run the full frontend suite and type-check**

```bash
cd frontend && npx vitest run && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no new failures. Watch `src/components/ProtectedRoute.test.tsx` and `src/utils/sheetPermissions.ts` consumers in particular — they exercise the same helpers.

- [ ] **Step 7: Commit** (only after the user says "commit")

```bash
git add frontend/src/stores/uiStore.ts frontend/src/utils/permissions.ts frontend/src/utils/permissions.bossEditMode.test.ts
git commit -m "feat(frontend): add boss view/edit mode gate to permission helpers"
```

---

### Task 5: Header view/edit toggle

The visible control that drives Task 4's state. Renders only for `role === 'boss'`.

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx` (header right-hand `Flex`, around line 496)
- Modify: `frontend/src/i18n/tk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: `useUiStore` → `bossEditMode`, `setBossEditMode` (Task 4).

- [ ] **Step 1: Add the i18n keys to all three locale files**

Add a new top-level `"boss_mode"` object to each of `tk.json`, `ru.json`, `en.json`:

| key | tk | ru | en |
|---|---|---|---|
| `boss_mode.view` | `Görmek` | `Просмотр` | `View` |
| `boss_mode.edit` | `Üýtgetmek` | `Редактирование` | `Edit` |
| `boss_mode.active` | `Üýtgetmek režimi` | `Режим редактирования` | `Edit mode` |
| `boss_mode.confirm_title` | `Üýtgetmek režimine geçmek` | `Перейти в режим редактирования` | `Switch to edit mode` |
| `boss_mode.confirm_body` | `Siz öz adyňyzdan üýtgetme girizersiňiz. Ähli üýtgetmeler audit žurnalynda "boss" hökmünde ýazylýar.` | `Вы будете вносить изменения от своего имени. Все правки записываются в журнал аудита как «boss».` | `You will make changes under your own account. Every edit is recorded in the audit log as "boss".` |
| `boss_mode.confirm_ok` | `Dowam et` | `Продолжить` | `Continue` |

- [ ] **Step 2: Verify the keys resolve**

```bash
cd frontend && python -c "
import json
keys=['view','edit','active','confirm_title','confirm_body','confirm_ok']
for loc in ['tk','ru','en']:
    d=json.load(open(f'src/i18n/{loc}.json',encoding='utf-8')).get('boss_mode',{})
    print(loc,'missing:',[k for k in keys if k not in d])
"
```

Expected: `missing: []` for all three.

- [ ] **Step 3: Render the toggle**

In `frontend/src/components/AppLayout.tsx`, add to the existing hook block near the other `useUiStore` / `useAuth` calls:

```tsx
  const bossEditMode = useUiStore((s) => s.bossEditMode);
  const setBossEditMode = useUiStore((s) => s.setBossEditMode);
  const isBoss = user?.role === 'boss';

  const handleBossModeChange = (value: string | number) => {
    if (value === 'view') {
      setBossEditMode(false);
      return;
    }
    Modal.confirm({
      title: t('boss_mode.confirm_title'),
      content: t('boss_mode.confirm_body'),
      okText: t('boss_mode.confirm_ok'),
      cancelText: t('common.cancel'),
      onOk: () => setBossEditMode(true),
    });
  };
```

Then insert into the header's right-hand `Flex` (line ~496), immediately before `<ConnectionStatus />`:

```tsx
            {isBoss && (
              <Flex align="center" gap={8}>
                <Segmented
                  size="small"
                  value={bossEditMode ? 'edit' : 'view'}
                  options={[
                    { label: t('boss_mode.view'), value: 'view' },
                    { label: t('boss_mode.edit'), value: 'edit' },
                  ]}
                  onChange={handleBossModeChange}
                />
                {bossEditMode && (
                  <Tag color="orange" style={{ margin: 0 }}>
                    {t('boss_mode.active')}
                  </Tag>
                )}
              </Flex>
            )}
```

`Segmented`, `Flex` and `Tooltip` are already imported in this file (the language switcher uses `Segmented`). Add `Modal` and `Tag` to the existing `antd` import if they are not there. `common.cancel` was verified present in all three locale files — no new key needed for the cancel button.

- [ ] **Step 4: Type-check and run the suite**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0 && npx vitest run
```

Expected: no errors, no new test failures.

- [ ] **Step 5: Verify in the browser**

Log in as a boss account:
1. The toggle shows **Просмотр** selected, no amber tag.
2. Open a shipment detail — fields are read-only.
3. Click **Редактирование** — a confirm dialog appears with the audit-log wording. Cancel it; the toggle stays on Просмотр.
4. Click again and confirm — the amber "Режим редактирования" tag appears and the same shipment's fields become editable.
5. Reload the page — the toggle is back on Просмотр.
6. Log in as an `export_manager` — no toggle is rendered and editing works as before.

Also verify the honest limitation from the spec: find one screen that does not call `canDo`/`canEditField` and confirm it stays editable in Просмотр mode. That is expected, not a bug — do not fix it here.

- [ ] **Step 6: Log the build for testing**

Append to the top of `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-08-05 — Boss process visibility: process-ordered sidebar, boss full permissions, boss transitions, view/edit toggle — NEEDS TEST
```

Then state plainly in the reply: *"Built — NOT tested yet. Did you test it?"*

- [ ] **Step 7: Commit** (only after the user says "commit")

```bash
git add frontend/src/components/AppLayout.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json BUILD_TEST_LOG.md
git commit -m "feat(frontend): add boss view/edit mode toggle to app header"
```

---

### Task 6: Documentation

Per the root `CLAUDE.md` rule: any feature change updates the Obsidian vault and the changelog.

**Files:** (located and confirmed to exist)
- Modify: `docs/obsidian/processes/permissions-system.md`
- Modify: `docs/obsidian/roles/boss.md`
- Modify: `CHANGELOG.md`

Read `docs/obsidian/00-index.md` first for the vault conventions. Update these two existing notes rather than creating new ones.

- [ ] **Step 1: Update `docs/obsidian/processes/permissions-system.md`**

Record four things:
- The `boss` role now defaults to every registered page and full CRUD on every resource (was 3 pages, view-only).
- `boss` is in `PRIVILEGED_ROLES` in `export/services/shipment.py`, so `transition_to()` accepts him on any edge. A second same-named constant in `core/roles.py` was deliberately left alone.
- The view/edit toggle lives in `utils/permissions.ts` and is a **UI guard, not a security boundary** — the backend accepts boss writes in both positions, and only the ~17 files calling `canDo`/`canEditField` respond to it.
- Boss holds `admin.permissions` and can therefore widen access for himself and anyone else.

- [ ] **Step 2: Update `docs/obsidian/roles/boss.md`**

Record: the boss reaches the whole process from his own login without impersonating other roles; the sidebar is ordered by process phase (groups 1–6); his session starts in **Просмотр** and he opts into editing per session; his edits appear in the audit log as `boss`.

Also note the navigation change itself in whichever note the vault index points to for screens/layout — if none covers the sidebar, add the sidebar paragraph to `permissions-system.md` alongside the visibility rules, since visibility and ordering are the same mechanism.

- [ ] **Step 4: Add the CHANGELOG entry**

Under `[Unreleased]`, Keep-a-Changelog style, newest section on top:

```markdown
### Added
- Boss view/edit mode toggle in the app header — read-only by default, opt-in editing (feat)
- Five previously URL-only pages surfaced in the sidebar: truck forecast, drafts, assignment, domestic sales, prices (feat)

### Changed
- Sidebar reordered by export process phase instead of by module (feat)
- Boss role widened from 3 read-only pages to full access on every page and resource (feat)
- `boss` added to `PRIVILEGED_ROLES` so he can trigger any valid status transition (feat)
```

- [ ] **Step 5: Commit** (only after the user says "commit")

```bash
git add docs/obsidian/ CHANGELOG.md
git commit -m "docs: record boss process visibility changes"
```

---

## Notes for the implementer

**Task order matters for Tasks 4 and 5 only** — Task 5 consumes state Task 4 creates. Tasks 1, 2 and 3 are independent of each other and of 4/5; they can run in any order or in parallel.

**Known risk carried from the spec (do not "fix" these):**

1. **AD-1 fallout.** Seven of the eight shipment lifecycle timestamps are operator-entered and null on new shipments. `ShipmentBoard` and `StuckShipments` read `updated_at` and status history instead, so they populate — but recent trucks will look sparse. **Do not build a stage-timeline widget on those timestamps.**
2. **The toggle covers only the ~17 files calling `canDo`/`canEditField`.** Other screens stay editable in view mode. Closing that gap app-wide is a separate, larger sweep.
3. **The reorder changes the menu for every role**, not just the boss. This was explicitly approved. Expect a day of "where did my screen go".
4. **Two divergent `PRIVILEGED_ROLES` constants** exist (`export/services/shipment.py:41` and `core/roles.py:54`). Only the first is changed here. Reconciling them is out of scope.

**Deferred (Phase 2, agreed 2026-08-05):** per-role configurable sidebar ordering. Ship the single global order first; build the configurable version only if a role proves it wrong. That would need a `role × page_code × sort_order` table, a drag-and-drop admin UI, and a fallback to the global default.
