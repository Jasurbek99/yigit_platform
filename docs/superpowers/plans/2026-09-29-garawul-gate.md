# Garawul (Gate Guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `garawul` role: a guard bound to one greenhouse location marks trucks «Ýyladyşhana geldi» / «Ýyladyşhanadan çykdy» from a phone screen or from his task cards, and the marks drive loading-start / departure and the status through the existing auto-advance.

**Architecture:** One backend service (`services/gate.py`) owns the two lists and the three actions. Every write is a plain `Shipment.save()`, so task resolution and `auto_advance_if_ready()` → `transition_to()` run exactly as for a Sheet edit. A second service (`services/gate_tasks.py`) keeps code-driven `kind='gate'` tasks equal to the lists, lazily on read. A dedicated `GateViewSet` exposes it. The frontend gets a phone-first `/export/gate` page and a gate card on My Tasks, both calling the same endpoint.

**Tech Stack:** Django 5 + DRF on MSSQL (mssql-django), React 18 + TypeScript + Ant Design + TanStack Query, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-29-garawul-gate-design.md`

## Global Constraints

- MSSQL: no JSONField/ArrayField/DISTINCT ON; `bulk_create(..., batch_size=500)`; `.order_by()` on any queryset wrapped in a subquery.
- Status changes ONLY through `transition_to()` — here always indirectly, via `Shipment.save()` → `auto_advance_if_ready()`.
- Dependency direction `core ← greenhouse ← export`. core may import export only lazily inside a function (existing pattern in `views_me.py`).
- Role code `garawul`; page code `export.gate`; resource code `gate`; route `/export/gate`; API `/api/v1/export/gate/`.
- Gate task steps `gate_arrive` / `gate_depart`; task kind `gate`; notification kind `gate_arrival`.
- Time for every mark = server `timezone.now()`; "today" = `timezone.localdate()` (`TIME_ZONE='Asia/Ashgabat'`).
- Gelmeli window: `date` from today−7 to today+1. Undo window: 10 minutes, and only if `status_changed_at` is null or earlier than the mark.
- Location of a truck: `loading_location` if set, else its blocks' `GreenhouseBlock.location`.
- API errors: `{"error": "<code>"}`. Codes: `not_expected`, `not_inside`, `not_here`, `undo_closed`, `season_closed`, `no_location`, `location_required`, `bad_location`, `bad_event`, `not_found`.
- The guard's payload never carries customer, firm, price or weight.
- UI copy never says draft/черновик/garalama (see memory "No Draft Word In UI").
- **Commits:** CLAUDE.md forbids committing without the user's explicit "commit". Ask once at the start of execution whether the per-task commit steps are approved; if not, skip every commit step.
- **Shared tree:** other sessions edit this tree and share the git index (today: `serializers.py`, `services/shipment.py`, `AppLayout.tsx`, `permissions-system.md` are dirty from the packaging-join work). Before every commit: `git status`, `git diff --cached`; stage only this task's paths; for a file another session also dirtied, commit only your hunks (`git add -p <file>`), never the whole file.
- **Migrations:** before each `makemigrations`, run `ls backend/apps/<app>/migrations | tail -3` and `git log --oneline -5`; the number must be the next free one and there must be one leaf. After it, `migrate <app>` and confirm with `showmigrations <app>` (memory "Apply Migrations Yourself").
- **Test runs:** backend `cd backend && ./venv/Scripts/python.exe manage.py test <label> --noinput --verbosity=1`. If another `manage.py test` process is running, use a private test DB (memory "Test DB Name Collision") before believing a red run. Frontend `cd frontend && npx vitest run <path>`; typecheck `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).

## Review Focus

1. Two guards (or one double tap) mark the same truck at once → exactly one mark, one notification set, the second caller gets `409 not_expected` — Task 4 `test_second_arrive_is_refused_and_notifies_once`.
2. The guard types the plate on a Russian keyboard, in lowercase or with spaces (`1535 акм`) → the truck `1535AKM` is found — Task 9 `plateSearch.test.ts`.
3. The truck's packaging is moved to another location before it arrives → its task leaves the old guard's board and appears on the new one — Task 5 `test_task_follows_the_packaging_to_another_location`.
4. The truck belongs to a closed season → `409 season_closed` and nothing is written — Task 4 `test_closed_season_is_refused_and_writes_nothing`.
5. Window edges on the Ashgabat calendar: today−7 and tomorrow are listed, today−8 and today+2 are not — Task 3 `test_date_window_edges`.

---

## File Structure

**Backend — create**
- `backend/apps/export/services/gate.py` — lists, row payload, `arrive` / `depart` / `undo`, arrival notification.
- `backend/apps/export/services/gate_tasks.py` — `sync_gate_tasks()`.
- `backend/apps/export/views_gate.py` — `GateViewSet`.
- `backend/apps/export/tests_gate_fixtures.py` — shared test mixin (no tests of its own).
- `backend/apps/export/tests_gate.py` — lists + actions.
- `backend/apps/export/tests_gate_tasks.py` — task sync.
- `backend/apps/export/tests_gate_api.py` — endpoint.
- `backend/apps/export/tests_greenhouse_arrival_row.py` — Sheet row.
- `backend/apps/core/tests_garawul.py` — role, location binding, permission seed.
- Migrations (numbers picked at write time): core `garawul_role_and_location`, core `seed_garawul_perms`; export `garawul_role_choices`, `shipment_greenhouse_arrived_at`, `notification_gate_arrival_kind`, `gate_tasks`, `seed_greenhouse_arrival_row`.

**Backend — modify**
- `backend/apps/core/models/user.py` — role + `loading_location`.
- `backend/apps/core/roles.py` — `GATE_GUARD_ROLE`.
- `backend/apps/export/views_admin.py` — user serializers + create.
- `backend/apps/core/permission_registry.py` — page, resource, `RESOURCE_FIELDS['shipment']`.
- `backend/apps/core/management/commands/seed_permissions.py` — defaults.
- `backend/apps/core/management/commands/seed_test_users.py` — `t_garawul`.
- `backend/apps/export/models/shipment.py`, `models/task.py`, `models/notification.py`.
- `backend/apps/core/views_me.py` — sync + location scope.
- `backend/apps/export/serializers.py` — `TaskListSerializer`, Sheet fields.
- `backend/apps/export/urls.py` — router.
- Sheet row: `sheet_rows.py`, `services/comments.py`, `management/commands/backfill_sheet_row_defaults.py`.

**Frontend — create**
- `frontend/src/utils/plateSearch.ts` (+ `.test.ts`)
- `frontend/src/hooks/useGate.ts`
- `frontend/src/components/gate/GateTruckCard.tsx`, `GateConfirmModal.tsx`
- `frontend/src/pages/export/GatePage.tsx` (+ `.test.tsx`)
- `frontend/src/pages/IndexRoute.tsx`
- `frontend/src/components/me/GateTaskCard.tsx` (+ `.test.tsx`)

**Frontend — modify**
- `types/index.ts`, `constants/roles.ts`, `pages/admin/permissions/roleColors.ts`, `pages/admin/UsersPage.tsx`, `pages/admin/StaffPageAccessPage.tsx`, `hooks/useAdmin.ts`, `utils/permissions.ts`, `components/NotificationBell.tsx`, `pages/export/TaskRulesPage.tsx`, `App.tsx`, `components/AppLayout.tsx`, `pages/me/SelfBoard.tsx`, `i18n/{tk,ru,en}.json`, Sheet: `components/sheet/{getCellValue,sheetRoleBlocks,sheetTopicOrder}.ts`, `mock/shipmentSheet.ts`.

---

### Task 1: Role `garawul` and the user's gate location

**Files:**
- Modify: `backend/apps/core/models/user.py`
- Modify: `backend/apps/core/roles.py` (append)
- Modify: `backend/apps/export/views_admin.py` (`UserListSerializer`, `UserPatchSerializer`, `UserManagementViewSet.create`)
- Create: migrations core `garawul_role_and_location`, export `garawul_role_choices`
- Test: `backend/apps/core/tests_garawul.py`

**Interfaces:**
- Produces: `User.loading_location` (FK → `core.LoadingLocation`, null, `PROTECT`, `related_name='gate_guards'`); `apps.core.roles.GATE_GUARD_ROLE = 'garawul'`; admin user API accepts/returns `loading_location` (int id or null).

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/core/tests_garawul.py`:

```python
"""Role `garawul` (gate guard): bound to one LoadingLocation.

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.1
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import LoadingLocation, User


class GarawulUserApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(username='gw_admin', password='pw', role='admin')
        cls.dusak = LoadingLocation.objects.create(name='Dusak')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_create_guard_without_location_is_refused(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g1', 'password': 'secret1', 'role': 'garawul',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('loading_location', resp.data)

    def test_create_guard_with_location_saves_it(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g2', 'password': 'secret1', 'role': 'garawul',
            'loading_location': self.dusak.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['loading_location'], self.dusak.pk)
        self.assertEqual(User.objects.get(username='g2').loading_location, self.dusak)

    def test_create_with_unknown_location_is_refused(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g3', 'password': 'secret1', 'role': 'garawul',
            'loading_location': 999999,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_to_guard_without_location_is_refused(self):
        user = User.objects.create_user(username='g4', password='pw', role='transport')
        resp = self.client.patch(f'/api/v1/export/admin/users/{user.pk}/', {'role': 'garawul'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_to_guard_with_location_saves_both(self):
        user = User.objects.create_user(username='g5', password='pw', role='transport')
        resp = self.client.patch(f'/api/v1/export/admin/users/{user.pk}/', {
            'role': 'garawul', 'loading_location': self.dusak.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        user.refresh_from_db()
        self.assertEqual((user.role, user.loading_location_id), ('garawul', self.dusak.pk))

    def test_other_roles_need_no_location(self):
        resp = self.client.post('/api/v1/export/admin/users/', {
            'username': 'g6', 'password': 'secret1', 'role': 'transport',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && ./venv/Scripts/python.exe manage.py test apps.core.tests_garawul --noinput`
Expected: FAIL — `"garawul" is not a valid choice` / `loading_location` unknown.

- [ ] **Step 3: Add the role and the FK**

In `backend/apps/core/models/user.py`, add to `ROLE_CHOICES` directly before `('boss', 'Boss'),`:

```python
    # garawul (gate guard): sits at one greenhouse gate (Dusak / Kaka /
    # Owadandepe) and marks trucks in and out. Bound to that gate by
    # User.loading_location. Sees only the gate screen and his gate tasks.
    ('garawul', 'Gate Guard'),
```

In `class User`, after `telegram_chat_id`:

```python
    # The one greenhouse gate a `garawul` works. Required for that role
    # (validated in the admin user API), unused by every other role.
    loading_location = models.ForeignKey(
        'core.LoadingLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='gate_guards',
    )
```

Append to `backend/apps/core/roles.py`:

```python
# The gate guard. Bound to one LoadingLocation (User.loading_location); the gate
# endpoint and My Tasks scope him to it. Identity, not a permission gate — access
# itself is the `gate` resource in the matrix.
GATE_GUARD_ROLE = 'garawul'
```

- [ ] **Step 4: Accept and validate the location in the admin user API**

In `backend/apps/export/views_admin.py`, add `from apps.core.models import LoadingLocation` and `from apps.core.roles import GATE_GUARD_ROLE` to the imports (extend the existing `apps.core.models` / `apps.core.roles` import lines if present).

`UserListSerializer.Meta`: add `'loading_location'` to both `fields` and `read_only_fields`.

Replace `UserPatchSerializer` with:

```python
class UserPatchSerializer(serializers.ModelSerializer):
    """Role, is_active and the gate location may be patched. Admin-only via partial_update gate (AD-15)."""

    class Meta:
        model = User
        fields = ['role', 'is_active', 'loading_location']

    def validate(self, attrs: dict) -> dict:
        role = attrs.get('role', getattr(self.instance, 'role', None))
        if 'loading_location' in attrs:
            location = attrs['loading_location']
        else:
            location = getattr(self.instance, 'loading_location', None)
        if role == GATE_GUARD_ROLE and location is None:
            raise serializers.ValidationError(
                {'loading_location': ['A gate guard needs a location.']}
            )
        return attrs
```

In `UserManagementViewSet.create`, after the `if not role:` block and before `if errors:`:

```python
        loading_location_id = request.data.get('loading_location') or None
        if loading_location_id is not None and not LoadingLocation.objects.filter(
            pk=loading_location_id,
        ).exists():
            errors['loading_location'] = ['Unknown location.']
        elif role == GATE_GUARD_ROLE and loading_location_id is None:
            errors['loading_location'] = ['A gate guard needs a location.']
```

and pass it to `create_user(...)`: add `loading_location_id=loading_location_id,`.

- [ ] **Step 5: Generate and check the migrations**

```bash
cd backend
ls apps/core/migrations | tail -3 ; ls apps/export/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations core --name garawul_role_and_location
./venv/Scripts/python.exe manage.py makemigrations export --name garawul_role_choices
./venv/Scripts/python.exe manage.py sqlmigrate export <the new export number>
```
Expected: core migration = `AddField user.loading_location` + choices-only `AlterField` on `role` of `user`, `rolefieldpermission`, `rolepagepermission`, `roleresourcepermission`. Export migration = choices-only `AlterField` on `sheetrowroletrigger.role` and `sheetrowsetting.role_group`; `sqlmigrate` prints no DDL for it.

Then apply: `./venv/Scripts/python.exe manage.py migrate core && ./venv/Scripts/python.exe manage.py migrate export && ./venv/Scripts/python.exe manage.py showmigrations core export | tail -6`

- [ ] **Step 6: Run the tests**

Run: `./venv/Scripts/python.exe manage.py test apps.core.tests_garawul --noinput`
Expected: 6 tests OK.

- [ ] **Step 7: Commit** (only with the user's approval — see Global Constraints)

```bash
git status && git diff --cached --stat
git add backend/apps/core/models/user.py backend/apps/core/roles.py backend/apps/export/views_admin.py backend/apps/core/tests_garawul.py backend/apps/core/migrations/*_garawul_role_and_location.py backend/apps/export/migrations/*_garawul_role_choices.py
git commit -m "feat(core): garawul role bound to one loading location"
```

---

### Task 2: Gate page and resource in the permission matrix

**Files:**
- Modify: `backend/apps/core/permission_registry.py`
- Modify: `backend/apps/core/management/commands/seed_permissions.py`
- Modify: `backend/apps/core/management/commands/seed_test_users.py`
- Create: core migration `seed_garawul_perms`
- Test: `backend/apps/core/tests_garawul.py` (append)

**Interfaces:**
- Consumes: role `garawul` (Task 1).
- Produces: page code `export.gate`; resource code `gate`. Seeded: `garawul` pages `{export.gate, me.board}` only, resource `gate` = view+edit; `admin`/`boss` full on `gate` + page visible; `director`/`export_manager`/`document_team` without gate page or resource.

- [ ] **Step 1: Write the failing tests** — append to `backend/apps/core/tests_garawul.py` (move the new `import` lines to the top of the file):

```python
import importlib
from pathlib import Path

from django.core.management import call_command

from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS
from apps.core.models import RolePagePermission, RoleResourcePermission
from apps.core.permission_registry import PAGE_REGISTRY


def _perm_migration():
    path = next(Path(__file__).parent.joinpath('migrations').glob('*_seed_garawul_perms.py'))
    return importlib.import_module(f'apps.core.migrations.{path.stem}')


class GarawulPermissionSeedTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def test_guard_sees_only_the_gate_and_his_tasks(self):
        visible = set(
            RolePagePermission.objects.filter(role='garawul', is_visible=True)
            .values_list('page_code', flat=True)
        )
        self.assertEqual(visible, {'export.gate', 'me.board'})

    def test_guard_has_a_row_for_every_page(self):
        # A partial matrix loses access on the next /admin/permissions Save.
        self.assertEqual(
            RolePagePermission.objects.filter(role='garawul').count(), len(PAGE_REGISTRY),
        )

    def test_guard_holds_gate_view_edit_and_no_shipment_grant(self):
        rows = {
            r.resource_code: (r.can_view, r.can_create, r.can_edit, r.can_delete)
            for r in RoleResourcePermission.objects.filter(role='garawul')
        }
        self.assertEqual(rows, {'gate': (True, False, True, False)})

    def test_gate_is_off_for_operational_wildcard_roles(self):
        for role in ('director', 'export_manager', 'document_team'):
            with self.subTest(role=role):
                self.assertFalse(
                    RoleResourcePermission.objects.filter(role=role, resource_code='gate').exists()
                )
                self.assertFalse(
                    RolePagePermission.objects.get(role=role, page_code='export.gate').is_visible
                )

    def test_admin_and_boss_hold_the_gate(self):
        for role in ('admin', 'boss'):
            with self.subTest(role=role):
                row = RoleResourcePermission.objects.get(role=role, resource_code='gate')
                self.assertTrue(row.can_view and row.can_edit)
                self.assertTrue(
                    RolePagePermission.objects.get(role=role, page_code='export.gate').is_visible
                )

    def test_migration_visible_set_matches_the_seeded_matrix(self):
        self.assertEqual(set(_perm_migration().VISIBLE_PAGES), PAGE_DEFAULTS['garawul'])

    def test_migration_snapshots_every_registered_page(self):
        self.assertEqual(set(_perm_migration().ALL_PAGES), set(PAGE_REGISTRY))
```

- [ ] **Step 2: Run to verify they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.core.tests_garawul --noinput`
Expected: FAIL (`StopIteration` from `_perm_migration`, no `garawul` rows).

- [ ] **Step 3: Register the page and the resource**

`backend/apps/core/permission_registry.py` — in `PAGE_REGISTRY`, after `('export.pallet_manifest',  'Pallet Manifest'),`:

```python
    # Gate guard screen (garawul, 2026-09-29): trucks due at / inside one greenhouse.
    ('export.gate',             'Gate (truck arrival / exit)'),
```

In `RESOURCE_REGISTRY`, after `('fleet', ...)`:

```python
    # Gate marks (arrival / exit at a greenhouse gate). All-or-nothing, so absent
    # from RESOURCE_FIELDS. can_view = read the lists, can_edit = mark / undo.
    ('gate',                  'Gate (truck arrival / exit marks)'),
```

- [ ] **Step 4: Seed defaults**

In `seed_permissions.py`, just below `_UNIVERSAL = ...`:

```python
# The gate screen and its resource belong to the guard (plus admin/boss, who hold
# everything). The operational wildcard roles are carved out: a nav entry they
# cannot use, and a mark they have no reason to make.
_GATE_PAGES = {'export.gate'}
_GATE_RESOURCES = {'gate'}
```

Change the three wildcard page sets:
- `'director': _ALL_PAGES - _ALL_ADMIN - {'feedback.admin_inbox'},` → `'director': _ALL_PAGES - _ALL_ADMIN - {'feedback.admin_inbox'} - _GATE_PAGES,`
- in `'export_manager'`: `_ALL_PAGES - _ALL_ADMIN - {'director.stuck_shipments', 'feedback.admin_inbox'}` → `_ALL_PAGES - _ALL_ADMIN - {'director.stuck_shipments', 'feedback.admin_inbox'} - _GATE_PAGES` (document_team copies it).

Add to `PAGE_DEFAULTS` (after `'quality_inspector'`):

```python
    # garawul (gate guard): the gate screen and his gate tasks — nothing else.
    # He sees trucks only through the gate lists, never the Sheet or the list.
    # Kept out of the every-role loops below (Fleet Map, Tır Takip) too.
    'garawul': {'export.gate', 'me.board'},
```

Fleet Map loop: `if _role != 'seller':` → `if _role not in ('seller', 'garawul'):`.
Tır Takip loop body → 

```python
for _role in PAGE_DEFAULTS:
    if _role == 'garawul':
        continue
    PAGE_DEFAULTS[_role] = PAGE_DEFAULTS[_role] | _TIR_TAKIP
```

`RESOURCE_DEFAULTS`: in `'director'` and `'export_manager'`, `**{r: _VCRUD for r in _ALL_RESOURCES},` → `**{r: _VCRUD for r in _ALL_RESOURCES - _GATE_RESOURCES},`. Add:

```python
    'garawul': {
        'gate': _VE,    # read the lists, mark / undo
    },
```

(`admin` and `boss` keep `gate` through their unchanged `_ALL_RESOURCES` wildcard.)

- [ ] **Step 5: Data migration for the live DB**

```bash
ls apps/core/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations core --empty --name seed_garawul_perms
```

Replace the generated body with (keep the generated `dependencies` line):

```python
"""Seed the permission matrix for `garawul` and add the gate to admin / boss.

seed_permissions only get_or_creates on a fresh DB; production runs `migrate`
only. Every page code gets a garawul row (hidden ones as is_visible=False) —
/admin/permissions Save deletes and recreates page rows, so a partial matrix
silently loses access (see core/0054).

Page codes are snapshotted so the migration replays identically forever.
Idempotent and reversible; clears the permission cache.
"""
import os

from django.db import migrations

ROLE = 'garawul'

# Snapshot of PAGE_REGISTRY as of 2026-09-29, including the new 'export.gate'.
# If another session registered a page since, the Step 1 test
# `test_migration_snapshots_every_registered_page` names it — add it here.
ALL_PAGES = [
    'dashboard', 'export.shipments', 'export.shipments_sheet',
    'export.shipments_dashboard', 'export.shipments.board', 'export.overdue',
    'export.advances', 'export.plan', 'export.harvest_board', 'export.quota',
    'export.quota.local_sell', 'export.prices', 'export.trucks', 'export.blocks',
    'export.pomidor_dukany', 'export.domestic_sales', 'export.drafts', 'export.assign',
    'export.pallet_manifest', 'export.gate', 'me.board', 'export.task_rules',
    'analytics.boss', 'analytics.clients', 'director.stuck_shipments', 'audit_log',
    'worklog', 'team_kpi', 'feedback.submit', 'feedback.my_tickets', 'feedback.public',
    'feedback.admin_inbox', 'contracts.list', 'contracts.sales', 'contracts.documents',
    'transport.map', 'transport.fleet', 'tir_takip', 'tir_takip.onumcilik',
    'tir_takip.gaplama', 'tir_takip.tirlar', 'tir_takip.export_rapor', 'tir_takip.hasabat',
    'tir_takip.gumruk_ewrak', 'tir_takip.kwota_takibi', 'tir_takip.sertnamalar',
    'tir_takip.datalar', 'export.sales_reports', 'export.sales_rep_coverage',
    'export.expense_template', 'export.packing_presets', 'admin.users',
    'admin.staff_access', 'admin.seasons', 'admin.firms', 'admin.import_firms',
    'admin.permissions', 'admin.blocks', 'admin.customers', 'admin.truck_dest',
    'admin.shipment_settings',
]

VISIBLE_PAGES = {'export.gate', 'me.board'}

# (can_view, can_create, can_edit, can_delete)
GUARD_RESOURCES = {'gate': (True, False, True, False)}
FULL = (True, True, True, True)


def seed(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    for page_code in ALL_PAGES:
        RolePagePermission.objects.get_or_create(
            role=ROLE, page_code=page_code,
            defaults={'is_visible': page_code in VISIBLE_PAGES},
        )
    for resource_code, flags in GUARD_RESOURCES.items():
        _grant(RoleResourcePermission, ROLE, resource_code, flags)

    for role in ('admin', 'boss'):
        RolePagePermission.objects.update_or_create(
            role=role, page_code='export.gate', defaults={'is_visible': True},
        )
        _grant(RoleResourcePermission, role, 'gate', FULL)
    # boss holds a '*' field row for every resource (tests_boss_access).
    RoleFieldPermission.objects.get_or_create(role='boss', resource_code='gate', field_name='*')

    for role in ('director', 'export_manager', 'document_team'):
        RolePagePermission.objects.get_or_create(
            role=role, page_code='export.gate', defaults={'is_visible': False},
        )
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RolePagePermission.objects.filter(role=ROLE).delete()
    RoleResourcePermission.objects.filter(role=ROLE).delete()
    RolePagePermission.objects.filter(page_code='export.gate').delete()
    RoleResourcePermission.objects.filter(resource_code='gate').delete()
    RoleFieldPermission.objects.filter(resource_code='gate').delete()
    _wipe_perm_cache()


def _grant(model, role, resource_code, flags):
    view, create, edit, delete = flags
    model.objects.update_or_create(
        role=role, resource_code=resource_code,
        defaults={'can_view': view, 'can_create': create, 'can_edit': edit, 'can_delete': delete},
    )


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        # keep the generated dependency (the garawul_role_and_location migration)
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
```

Then `migrate core` + `showmigrations core | tail -3`.

- [ ] **Step 6: Test login for the role** — `seed_test_users.py`: add `'garawul',` to `ROLES` (alphabetical position after `'finansist'`), and in `handle()` replace `user.save()` with:

```python
            if role == 'garawul':
                from apps.core.models import LoadingLocation
                user.loading_location = LoadingLocation.objects.filter(name='Dusak').first()
            user.save()
```

- [ ] **Step 7: Run tests**

Run: `./venv/Scripts/python.exe manage.py test apps.core.tests_garawul apps.core.tests_boss_access apps.core.tests_permission_matrix apps.core.tests_quality_inspector --noinput`
Expected: all OK. If `tests_permission_matrix` asserts a role's page/resource set that now excludes `export.gate`/`gate`, update that expectation (the carve-out is intended) and say so in the task report.

- [ ] **Step 8: Commit** (with approval)

```bash
git add backend/apps/core/permission_registry.py backend/apps/core/management/commands/seed_permissions.py backend/apps/core/management/commands/seed_test_users.py backend/apps/core/tests_garawul.py backend/apps/core/migrations/*_seed_garawul_perms.py
git commit -m "feat(core): gate page and resource in the permission matrix"
```

---

### Task 3: The two gate lists

**Files:**
- Modify: `backend/apps/export/models/shipment.py`
- Create: export migration `shipment_greenhouse_arrived_at`
- Create: `backend/apps/export/services/gate.py`
- Create: `backend/apps/export/tests_gate_fixtures.py`
- Test: `backend/apps/export/tests_gate.py`

**Interfaces:**
- Produces (`apps.export.services.gate`):
  - `PRE_DEPARTURE: tuple[str, ...]`, `DAYS_BACK = 7`, `DAYS_AHEAD = 1`, `UNDO_WINDOW = timedelta(minutes=10)`
  - `location_q(location: LoadingLocation) -> Q`
  - `expected(location) -> QuerySet[Shipment]`, `inside(location) -> QuerySet[Shipment]`, `recently_left(location, now: datetime | None = None) -> QuerySet[Shipment]`
  - `can_undo(shipment: Shipment, event: str, now: datetime | None = None) -> bool` (`event` in `'arrive' | 'depart'`)
  - `gate_row(shipment: Shipment, undo_event: str | None = None, now: datetime | None = None) -> dict`
- Produces (tests): `GateFixtures` mixin with `make_gate_world()` (classmethod) and `make_truck(code, *, status='gumruk_chykysh', block=None, plate='1535AKM', days=0, **extra) -> Shipment`.

- [ ] **Step 1: Shared fixtures** — create `backend/apps/export/tests_gate_fixtures.py`:

```python
"""Shared setup for the gate tests. A plain mixin — it holds no tests itself."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.core.models import GreenhouseBlock, LoadingLocation, Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRulesCommand
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [
    ('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS'), ('gumruk_chykysh', 2, 'CUSTOMS'),
    ('yuklenme', 3, 'LOADING'), ('yola_chykdy', 4, 'TRANSIT'), ('serhet_gechdi', 5, 'BORDER'),
    ('dest_entry', 6, 'BORDER'), ('barysh_gumrugi', 7, 'BORDER'), ('transshipment', 8, 'SALES'),
    ('bardy', 9, 'SALES'), ('satylyar', 10, 'SALES'), ('satyldy', 11, 'SALES'),
    ('tamamlandy', 12, 'COMPLETE'), ('cancelled', 99, 'COMPLETE'),
]


class GateFixtures:

    @classmethod
    def make_gate_world(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.dusak = LoadingLocation.objects.create(name='Dusak')
        cls.kaka = LoadingLocation.objects.create(name='Kaka')
        cls.block_d = GreenhouseBlock.objects.create(code='GD', location=cls.dusak)
        cls.block_k = GreenhouseBlock.objects.create(code='GK', location=cls.kaka)
        cls.guard = User.objects.create_user(
            username='gate_d', password='pw', role='garawul', loading_location=cls.dusak,
        )
        cls.guard_kaka = User.objects.create_user(
            username='gate_k', password='pw', role='garawul', loading_location=cls.kaka,
        )
        cls.head = User.objects.create_user(username='gate_head', password='pw', role='loading_dept_head')
        cls.deputy = User.objects.create_user(
            username='gate_dep', password='pw', role='loading_dept_head_deputy',
        )
        cls.idle_deputy = User.objects.create_user(
            username='gate_dep_off', password='pw', role='loading_dept_head_deputy', is_active=False,
        )

    def make_truck(self, code, *, status='gumruk_chykysh', block=None, plate='1535AKM',
                   days=0, **extra) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code,
            date=timezone.localdate() + timedelta(days=days),
            season=extra.pop('season', self.season),
            status=ShipmentStatusType.objects.get(code=status),
            truck_plate=plate,
            created_by=self.head,
            updated_by=self.head,
            **extra,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=block or self.block_d, weight_kg=Decimal('1000'),
        )
        generate_tasks_for_status(shipment, status)
        return Shipment.objects.select_related('status').get(pk=shipment.pk)
```

- [ ] **Step 2: Write the failing list tests** — create `backend/apps/export/tests_gate.py`:

```python
"""Gate guard: lists and actions (services/gate.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.2–1.3
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Customer
from apps.export.services import gate
from apps.export.tests_gate_fixtures import GateFixtures


class GateListTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def _ids(self, qs):
        return set(qs.values_list('pk', flat=True))

    def test_truck_with_a_block_at_the_location_is_expected(self):
        truck = self.make_truck('G-1')
        self.assertIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.kaka)))

    def test_loading_location_wins_over_the_blocks(self):
        truck = self.make_truck('G-2', block=self.block_k, loading_location=self.dusak)
        self.assertIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.kaka)))

    def test_plate_is_required(self):
        blank = self.make_truck('G-3', plate='')
        none = self.make_truck('G-4', plate=None)
        ids = self._ids(gate.expected(self.dusak))
        self.assertNotIn(blank.pk, ids)
        self.assertNotIn(none.pk, ids)

    def test_packing_part_is_not_listed_until_it_has_a_destination(self):
        part = self.make_truck('G-P1', status='draft')
        self.assertNotIn(part.pk, self._ids(gate.expected(self.dusak)))
        part.customer = Customer.objects.create(name='Gate buyer')
        part.save()
        self.assertIn(part.pk, self._ids(gate.expected(self.dusak)))

    def test_only_statuses_before_departure(self):
        buyer = Customer.objects.create(name='Gate buyer 2')
        listed = [
            self.make_truck(f'G-S{i}', status=s, customer=buyer)
            for i, s in enumerate(gate.PRE_DEPARTURE)
        ]
        gone = self.make_truck('G-S9', status='yola_chykdy')
        ids = self._ids(gate.expected(self.dusak))
        self.assertTrue(all(t.pk in ids for t in listed))
        self.assertNotIn(gone.pk, ids)

    def test_cancelled_deleted_and_archived_are_excluded(self):
        cancelled = self.make_truck('G-5', status='cancelled')
        deleted = self.make_truck('G-6', deleted_at=timezone.now())
        archived = self.make_truck('G-7', is_archived=True)
        ids = self._ids(gate.expected(self.dusak))
        self.assertFalse({cancelled.pk, deleted.pk, archived.pk} & ids)

    def test_date_window_edges(self):
        in_back = self.make_truck('G-W1', days=-7)
        out_back = self.make_truck('G-W2', days=-8)
        in_ahead = self.make_truck('G-W3', days=1)
        out_ahead = self.make_truck('G-W4', days=2)
        ids = self._ids(gate.expected(self.dusak))
        self.assertTrue({in_back.pk, in_ahead.pk} <= ids)
        self.assertFalse({out_back.pk, out_ahead.pk} & ids)

    def test_arrived_truck_moves_from_expected_to_inside(self):
        truck = self.make_truck('G-8', greenhouse_arrived_at=timezone.now())
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertIn(truck.pk, self._ids(gate.inside(self.dusak)))

    def test_inside_ignores_status(self):
        truck = self.make_truck('G-9', status='yola_chykdy', greenhouse_arrived_at=timezone.now())
        self.assertIn(truck.pk, self._ids(gate.inside(self.dusak)))

    def test_recently_left_holds_ten_minutes(self):
        now = timezone.now()
        fresh = self.make_truck('G-10', greenhouse_arrived_at=now - timedelta(hours=1),
                                departed_at=now - timedelta(minutes=9))
        stale = self.make_truck('G-11', greenhouse_arrived_at=now - timedelta(hours=1),
                                departed_at=now - timedelta(minutes=11))
        ids = self._ids(gate.recently_left(self.dusak, now))
        self.assertIn(fresh.pk, ids)
        self.assertNotIn(stale.pk, ids)

    def test_row_carries_only_gate_fields(self):
        truck = self.make_truck('G-12', driver_name='Aman', driver_phone='+99365000000')
        row = gate.gate_row(truck)
        self.assertEqual(set(row), {
            'id', 'shipment_code', 'truck_plate', 'truck_plate_2', 'driver_name', 'driver_phone',
            'date', 'is_gapy_satys', 'status_code', 'greenhouse_arrived_at', 'departed_at',
            'can_undo',
        })
        self.assertEqual(row['status_code'], 'gumruk_chykysh')
        self.assertFalse(row['can_undo'])

    def test_can_undo_rules(self):
        now = timezone.now()
        mark = now - timedelta(minutes=5)
        truck = self.make_truck('G-13', greenhouse_arrived_at=mark)
        truck.status_changed_at = mark - timedelta(hours=1)
        self.assertTrue(gate.can_undo(truck, 'arrive', now))
        self.assertFalse(gate.can_undo(truck, 'arrive', mark + timedelta(minutes=11)))
        truck.status_changed_at = mark + timedelta(seconds=1)
        self.assertFalse(gate.can_undo(truck, 'arrive', now))
        truck.status_changed_at = None
        truck.departed_at = now
        self.assertFalse(gate.can_undo(truck, 'arrive', now))
        self.assertTrue(gate.can_undo(truck, 'depart', now))
```

- [ ] **Step 3: Run to verify they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate --noinput`
Expected: FAIL — `ImportError: cannot import name 'gate'` / unknown field `greenhouse_arrived_at`.

- [ ] **Step 4: Add the column** — in `backend/apps/export/models/shipment.py`, directly after `departed_at = models.DateTimeField(null=True, blank=True)`:

```python
    # Gate arrival (garawul, 2026-09-29): stamped with server time by the gate
    # service; admin / loading head correct it on the Sheet («Ýyladyşhana geldi»).
    # Exit reuses departed_at (R21 «Ýyladyşhanadan çykdy»).
    greenhouse_arrived_at = models.DateTimeField(null=True, blank=True)
```

```bash
ls apps/export/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations export --name shipment_greenhouse_arrived_at
./venv/Scripts/python.exe manage.py migrate export && ./venv/Scripts/python.exe manage.py showmigrations export | tail -3
```

- [ ] **Step 5: Implement the lists** — create `backend/apps/export/services/gate.py`:

```python
"""Gate guard (garawul): trucks arriving at and leaving one greenhouse location.

Two lists — Gelmeli (expected) and Ýyladyşhanada (inside) — and the marks that
move a truck between them. Every write is a plain Shipment.save(), so task
resolution and auto_advance_if_ready() run exactly as for a Sheet edit and the
status still only changes inside transition_to().

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md
"""
from datetime import datetime, timedelta

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.export.models import Shipment, ShipmentBlockSource

PRE_DEPARTURE = ('draft', 'gumruk_girish', 'gumruk_chykysh', 'yuklenme')
DAYS_BACK = 7
DAYS_AHEAD = 1
UNDO_WINDOW = timedelta(minutes=10)


def location_q(location) -> Q:
    """Trucks at `location`: their own loading_location, else their blocks' location.

    No live shipment had loading_location on 2026-09-29, so the blocks carry the
    location until the gate stamps it at arrival.
    """
    via_blocks = (
        ShipmentBlockSource.objects
        .filter(block__location=location)
        .order_by()
        .values('shipment_id')
    )
    return Q(loading_location=location) | Q(loading_location__isnull=True, pk__in=via_blocks)


def _live() -> QuerySet:
    return (
        Shipment.objects
        .filter(is_archived=False, deleted_at__isnull=True)
        .exclude(status__code='cancelled')
        .select_related('status')
    )


def expected(location) -> QuerySet:
    """Gelmeli: plated trucks due at `location` that have not arrived or left."""
    today = timezone.localdate()
    return (
        _live()
        .filter(location_q(location))
        .filter(status__code__in=PRE_DEPARTURE)
        # A packing part (draft, no destination) is deleted by Join — a gate
        # stamp on it would vanish. It shows up once it is joined / given a
        # destination, same as its tasks (owner rule 2026-09-29).
        .exclude(status__code='draft', country__isnull=True, customer__isnull=True)
        .exclude(truck_plate__isnull=True)
        .exclude(truck_plate='')
        .filter(greenhouse_arrived_at__isnull=True, departed_at__isnull=True)
        .filter(
            date__gte=today - timedelta(days=DAYS_BACK),
            date__lte=today + timedelta(days=DAYS_AHEAD),
        )
        .order_by('date', 'id')
    )


def inside(location) -> QuerySet:
    """Ýyladyşhanada: arrived, not left. Status is ignored on purpose — a status
    move must never hide a truck that is physically inside."""
    return (
        _live()
        .filter(location_q(location))
        .filter(greenhouse_arrived_at__isnull=False, departed_at__isnull=True)
        .order_by('greenhouse_arrived_at', 'id')
    )


def recently_left(location, now: datetime | None = None) -> QuerySet:
    """Left within the undo window — shown greyed so the exit can be undone."""
    now = now or timezone.now()
    return (
        _live()
        .filter(location_q(location))
        .filter(greenhouse_arrived_at__isnull=False, departed_at__gte=now - UNDO_WINDOW)
        .order_by('-departed_at', 'id')
    )


def can_undo(shipment: Shipment, event: str, now: datetime | None = None) -> bool:
    """A mark may be undone for 10 minutes, and only while the status has not
    moved since — a transition has no way back."""
    now = now or timezone.now()
    if event == 'arrive':
        if shipment.departed_at is not None:
            return False
        mark = shipment.greenhouse_arrived_at
    else:
        mark = shipment.departed_at
    if mark is None or now - mark > UNDO_WINDOW:
        return False
    changed = shipment.status_changed_at
    return changed is None or changed < mark


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def gate_row(shipment: Shipment, undo_event: str | None = None,
             now: datetime | None = None) -> dict:
    """The guard's view of a truck — no customer, firm, price or weight."""
    return {
        'id': shipment.pk,
        'shipment_code': shipment.shipment_code,
        'truck_plate': shipment.truck_plate,
        'truck_plate_2': shipment.truck_plate_2,
        'driver_name': shipment.driver_name,
        'driver_phone': shipment.driver_phone,
        'date': shipment.date.isoformat(),
        'is_gapy_satys': shipment.is_gapy_satys,
        'status_code': shipment.status.code,
        'greenhouse_arrived_at': _iso(shipment.greenhouse_arrived_at),
        'departed_at': _iso(shipment.departed_at),
        'can_undo': bool(undo_event) and can_undo(shipment, undo_event, now),
    }
```

- [ ] **Step 6: Run the tests**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate --noinput`
Expected: 12 tests OK.

- [ ] **Step 7: Commit** (with approval)

```bash
git add backend/apps/export/models/shipment.py backend/apps/export/migrations/*_shipment_greenhouse_arrived_at.py backend/apps/export/services/gate.py backend/apps/export/tests_gate_fixtures.py backend/apps/export/tests_gate.py
git commit -m "feat(p3): gate lists — trucks expected at and inside a greenhouse"
```

---

### Task 4: Gate actions — arrive, depart, undo

**Files:**
- Modify: `backend/apps/export/services/gate.py`
- Modify: `backend/apps/export/models/notification.py` (+ export migration `notification_gate_arrival_kind`)
- Test: `backend/apps/export/tests_gate.py` (append)

**Interfaces:**
- Consumes: Task 3 lists; `apps.export.services.sheet_audit.snapshot_fields/diff_audit_rows`; `apps.core.seasons.assert_season_open/SeasonClosedError`.
- Produces: `class GateError(Exception)` with `.code: str`; `arrive(shipment_id: int, location, user) -> Shipment`; `depart(shipment_id: int, location, user) -> Shipment`; `undo(shipment_id: int, location, user, event: str) -> Shipment`. All raise `Shipment.DoesNotExist` for an unknown id and `GateError` for a state they refuse.

- [ ] **Step 1: Write the failing tests** — append to `backend/apps/export/tests_gate.py` (move the new `import` lines to the top of the file, with the existing ones):

```python
from decimal import Decimal

from apps.core.models import Season, TomatoVariety
from apps.export.models import AuditLog, Notification, Task, TaskState


class GateActionTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()
        cls.variety = TomatoVariety.objects.create(name='Gate Pink')

    def test_arrive_stamps_time_location_and_loading_start(self):
        truck = self.make_truck('A-1', status='gumruk_girish')
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertIsNotNone(result.greenhouse_arrived_at)
        self.assertEqual(result.loading_location, self.dusak)
        self.assertEqual(result.loading_started_at, result.greenhouse_arrived_at)
        self.assertEqual(result.status.code, 'gumruk_girish')  # docs not done: nothing moves yet

    def test_arrive_keeps_an_existing_loading_start(self):
        earlier = timezone.now() - timedelta(hours=2)
        truck = self.make_truck('A-2', status='gumruk_girish', loading_started_at=earlier)
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.loading_started_at, earlier)

    def test_arrive_from_customs_exit_starts_loading(self):
        truck = self.make_truck('A-3', status='gumruk_chykysh')
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'yuklenme')

    def test_arrive_notifies_head_and_active_deputies_only(self):
        truck = self.make_truck('A-4')
        gate.arrive(truck.pk, self.dusak, self.guard)
        notified = set(
            Notification.objects.filter(kind='gate_arrival').values_list('user_id', flat=True)
        )
        self.assertEqual(notified, {self.head.pk, self.deputy.pk})
        message = Notification.objects.filter(kind='gate_arrival').first().message
        self.assertIn('1535AKM', message)
        self.assertIn('Dusak', message)

    def test_second_arrive_is_refused_and_notifies_once(self):
        truck = self.make_truck('A-5')
        gate.arrive(truck.pk, self.dusak, self.guard)
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'not_expected')
        self.assertEqual(Notification.objects.filter(kind='gate_arrival').count(), 2)

    def test_other_locations_truck_is_refused(self):
        truck = self.make_truck('A-6')
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.kaka, self.guard_kaka)
        self.assertEqual(ctx.exception.code, 'not_expected')

    def test_arrive_is_audited_as_the_guard(self):
        truck = self.make_truck('A-7')
        gate.arrive(truck.pk, self.dusak, self.guard)
        fields = set(
            AuditLog.objects.filter(object_id=truck.pk, user=self.guard)
            .values_list('field_name', flat=True)
        )
        self.assertTrue({'greenhouse_arrived_at', 'loading_location', 'loading_started_at'} <= fields)

    def test_closed_season_is_refused_and_writes_nothing(self):
        closed = Season.objects.create(
            name='2024-2025', start_date='2024-09-01', end_date='2025-06-30',
            is_active=False, closed_at=timezone.now(),
        )
        truck = self.make_truck('A-8', season=closed)
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'season_closed')
        truck.refresh_from_db()
        self.assertIsNone(truck.greenhouse_arrived_at)
        self.assertFalse(Notification.objects.filter(kind='gate_arrival').exists())

    def _loaded_truck(self, code, **extra):
        truck = self.make_truck(code, status='yuklenme', variety=self.variety,
                                weight_net=Decimal('18000'), **extra)
        truck.save()  # resolve fill_loading_data now that its fields are set
        return gate.arrive(truck.pk, self.dusak, self.guard)

    def test_depart_moves_a_loaded_truck_to_the_road(self):
        truck = self._loaded_truck('D-1')
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertIsNotNone(result.departed_at)
        self.assertEqual(result.status.code, 'yola_chykdy')

    def test_depart_completes_a_gapy_truck(self):
        truck = self._loaded_truck('D-2', is_gapy_satys=True)
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'tamamlandy')

    def test_depart_without_loading_data_keeps_the_status(self):
        truck = self.make_truck('D-3', status='yuklenme')
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'yuklenme')

    def test_depart_needs_an_arrival(self):
        truck = self.make_truck('D-4')
        with self.assertRaises(gate.GateError) as ctx:
            gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'not_inside')

    def test_undo_arrive_clears_what_the_guard_wrote(self):
        truck = self.make_truck('U-1', status='gumruk_girish')
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertIsNone(result.greenhouse_arrived_at)
        self.assertIsNone(result.loading_started_at)

    def test_undo_arrive_keeps_a_loading_start_it_did_not_write(self):
        earlier = timezone.now() - timedelta(hours=2)
        truck = self.make_truck('U-2', status='gumruk_girish', loading_started_at=earlier)
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(result.loading_started_at, earlier)

    def test_undo_after_a_status_move_is_refused(self):
        truck = self.make_truck('U-3', status='gumruk_chykysh')
        gate.arrive(truck.pk, self.dusak, self.guard)  # → yuklenme
        with self.assertRaises(gate.GateError) as ctx:
            gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(ctx.exception.code, 'undo_closed')

    def test_undo_depart_reopens_the_departure_trigger(self):
        truck = self.make_truck('U-4', status='yuklenme')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.depart(truck.pk, self.dusak, self.guard)  # loading data missing: stays yuklenme
        trigger = Task.objects.get(shipment=truck, title_key='tasks.trigger_departure')
        self.assertEqual(trigger.state, TaskState.DONE)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'depart')
        self.assertIsNone(result.departed_at)
        trigger.refresh_from_db()
        self.assertEqual(trigger.state, TaskState.OPEN)
```

- [ ] **Step 2: Run to verify they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate --noinput`
Expected: FAIL — `AttributeError: module ... has no attribute 'arrive'`.

- [ ] **Step 3: Notification kind** — in `backend/apps/export/models/notification.py` `KIND_CHOICES`, before the `# Deprecated` block:

```python
        # Gate guard marked a truck in at a greenhouse (services/gate.py).
        ('gate_arrival', 'Truck arrived at greenhouse'),
```

```bash
ls apps/export/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations export --name notification_gate_arrival_kind
./venv/Scripts/python.exe manage.py migrate export
```

- [ ] **Step 4: Implement the actions** — in `services/gate.py`, extend the imports:

```python
from django.db import transaction

from apps.core.seasons import SeasonClosedError, assert_season_open
```

and append:

```python
ARRIVAL_NOTIFY_ROLES = ('loading_dept_head', 'loading_dept_head_deputy')
AUDITED_FIELDS = ['greenhouse_arrived_at', 'loading_location', 'loading_started_at', 'departed_at']


class GateError(Exception):
    """The truck is not in a state this action accepts. The view answers 409."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def arrive(shipment_id: int, location, user) -> Shipment:
    """«Ýyladyşhana geldi»: stamp arrival, start loading if nobody has, notify."""
    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not expected(location).filter(pk=shipment_id).exists():
            raise GateError('not_expected')
        _assert_open(shipment)
        before = _snapshot(shipment)
        now = timezone.now()
        shipment.greenhouse_arrived_at = now
        if shipment.loading_location_id is None:
            shipment.loading_location = location
        if shipment.loading_started_at is None:
            shipment.loading_started_at = now
        _save_audited(shipment, user, before)
        _notify_arrival(shipment, location)
    return _fresh(shipment_id)


def depart(shipment_id: int, location, user) -> Shipment:
    """«Ýyladyşhanadan çykdy»: fill R21 departed_at; auto-advance does the rest."""
    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not inside(location).filter(pk=shipment_id).exists():
            raise GateError('not_inside')
        _assert_open(shipment)
        before = _snapshot(shipment)
        shipment.departed_at = timezone.now()
        _save_audited(shipment, user, before)
    return _fresh(shipment_id)


def undo(shipment_id: int, location, user, event: str) -> Shipment:
    """Take back the last mark, within UNDO_WINDOW and before any status move."""
    with transaction.atomic():
        shipment = _lock(shipment_id)
        if not _live().filter(location_q(location)).filter(pk=shipment_id).exists():
            raise GateError('not_here')
        if not can_undo(shipment, event):
            raise GateError('undo_closed')
        _assert_open(shipment)
        before = _snapshot(shipment)
        if event == 'depart':
            _reopen_tasks_closed_by(shipment, 'departed_at', shipment.departed_at)
            shipment.departed_at = None
        else:
            mark = shipment.greenhouse_arrived_at
            shipment.greenhouse_arrived_at = None
            if shipment.loading_started_at == mark:
                _reopen_tasks_closed_by(shipment, 'loading_started_at', mark)
                shipment.loading_started_at = None
        _save_audited(shipment, user, before)
    return _fresh(shipment_id)


def _lock(shipment_id: int) -> Shipment:
    return Shipment.objects.select_for_update().get(pk=shipment_id)


def _fresh(shipment_id: int) -> Shipment:
    return Shipment.objects.select_related('status', 'loading_location').get(pk=shipment_id)


def _assert_open(shipment: Shipment) -> None:
    try:
        assert_season_open(shipment.season)
    except SeasonClosedError as exc:
        raise GateError('season_closed') from exc


def _snapshot(shipment: Shipment) -> dict[str, str]:
    from apps.export.services.sheet_audit import snapshot_fields
    return snapshot_fields(shipment, AUDITED_FIELDS)


def _save_audited(shipment: Shipment, user, before: dict[str, str]) -> None:
    """Save through the normal pipeline (task resolution + auto-advance) and
    write one AuditLog row per changed field, credited to the guard."""
    from apps.export.models.audit import AuditLog
    from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields

    shipment.updated_by = user
    try:
        shipment.save()
    except SeasonClosedError as exc:
        raise GateError('season_closed') from exc
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, AUDITED_FIELDS), user)
    if rows:
        AuditLog.objects.bulk_create(rows, batch_size=500)


def _reopen_tasks_closed_by(shipment: Shipment, field: str, since: datetime | None) -> None:
    """A status task this mark closed must come back when the mark is undone —
    the resolver never reopens DONE tasks, and a DONE trigger over an empty
    field would let the next save auto-advance the truck anyway."""
    from apps.export.models import Task, TaskState

    if since is None:
        return
    Task.objects.filter(
        shipment=shipment,
        state=TaskState.DONE,
        completed_at__gte=since,
        target_fields__contains=field,
    ).update(state=TaskState.OPEN, completed_at=None, completed_by=None)


def _notify_arrival(shipment: Shipment, location) -> None:
    from apps.core.models import User
    from apps.export.models import Notification

    message = f'{shipment.truck_plate} — {location.name}'[:500]
    link = f'/shipments/{shipment.pk}'
    recipients = User.objects.filter(is_active=True, role__in=ARRIVAL_NOTIFY_ROLES)
    Notification.objects.bulk_create(
        [Notification(user=u, kind='gate_arrival', message=message, link=link) for u in recipients],
        batch_size=500,
    )
```

- [ ] **Step 5: Run the tests**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate apps.export.tests_auto_advance --noinput`
Expected: all OK. If `test_depart_moves_a_loaded_truck_to_the_road` stays `yuklenme`, print `Task.objects.filter(shipment=truck, step='yuklenme').values('title_key','state','completion_rule')` — every non-`manual_done` task on the step must be DONE; fill whichever target field the seeded rule still lacks in `_loaded_truck` (do not weaken the assertion).

- [ ] **Step 6: Commit** (with approval)

```bash
git add backend/apps/export/services/gate.py backend/apps/export/models/notification.py backend/apps/export/migrations/*_notification_gate_arrival_kind.py backend/apps/export/tests_gate.py
git commit -m "feat(p3): gate marks — arrive, depart and 10-minute undo"
```

---

### Task 5: Gate tasks on the guard's board

**Files:**
- Modify: `backend/apps/export/models/task.py` (+ export migration `gate_tasks`)
- Create: `backend/apps/export/services/gate_tasks.py`
- Modify: `backend/apps/export/services/gate.py` (call the sync from each action)
- Modify: `backend/apps/core/views_me.py`
- Modify: `backend/apps/export/serializers.py` (`TaskListSerializer`)
- Test: `backend/apps/export/tests_gate_tasks.py`

**Interfaces:**
- Consumes: `expected`, `inside` (Task 3); actions (Task 4); `GATE_GUARD_ROLE` (Task 1).
- Produces: `TaskKind.GATE = 'gate'`; `Task.scope_location` FK; `sync_gate_tasks(location, *, shipment_id: int | None = None, actor=None) -> None`; constants `STEP_ARRIVE = 'gate_arrive'`, `STEP_DEPART = 'gate_depart'`; task list items gain `truck_plate: str | None` and `scope_location: int | None`.

- [ ] **Step 1: Write the failing tests** — create `backend/apps/export/tests_gate_tasks.py`:

```python
"""Gate tasks mirror the gate lists (services/gate_tasks.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.4
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.export.models import ShipmentBlockSource, Task, TaskKind, TaskState
from apps.export.services import gate
from apps.export.services.gate_tasks import STEP_ARRIVE, STEP_DEPART, sync_gate_tasks
from apps.export.tests_gate_fixtures import GateFixtures


class GateTaskSyncTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def _task(self, truck, step):
        return Task.objects.get(kind=TaskKind.GATE, shipment=truck, step=step)

    def test_expected_truck_gets_one_open_arrive_task(self):
        truck = self.make_truck('T-1')
        sync_gate_tasks(self.dusak)
        sync_gate_tasks(self.dusak)
        task = self._task(truck, STEP_ARRIVE)
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(task.assignee_role, 'garawul')
        self.assertEqual(task.scope_location, self.dusak)
        self.assertIsNone(task.deadline)
        self.assertEqual(Task.objects.filter(kind=TaskKind.GATE, shipment=truck).count(), 1)

    def test_arrival_closes_the_arrive_task_for_the_guard_and_opens_exit(self):
        truck = self.make_truck('T-2')
        sync_gate_tasks(self.dusak)
        gate.arrive(truck.pk, self.dusak, self.guard)
        arrive_task = self._task(truck, STEP_ARRIVE)
        self.assertEqual((arrive_task.state, arrive_task.completed_by), (TaskState.DONE, self.guard))
        self.assertEqual(self._task(truck, STEP_DEPART).state, TaskState.OPEN)

    def test_exit_closes_the_exit_task(self):
        truck = self.make_truck('T-3')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.depart(truck.pk, self.dusak, self.guard)
        exit_task = self._task(truck, STEP_DEPART)
        self.assertEqual((exit_task.state, exit_task.completed_by), (TaskState.DONE, self.guard))

    def test_undo_arrive_reopens_arrive_and_cancels_exit(self):
        truck = self.make_truck('T-4', status='gumruk_girish')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.OPEN)
        self.assertEqual(self._task(truck, STEP_DEPART).state, TaskState.CANCELLED)

    def test_deleted_truck_cancels_its_open_task(self):
        truck = self.make_truck('T-5')
        sync_gate_tasks(self.dusak)
        truck.deleted_at = timezone.now()
        truck.save()
        sync_gate_tasks(self.dusak)
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.CANCELLED)

    def test_task_follows_the_packaging_to_another_location(self):
        truck = self.make_truck('T-6')
        sync_gate_tasks(self.dusak)
        ShipmentBlockSource.objects.filter(shipment=truck).update(block=self.block_k)
        sync_gate_tasks(self.dusak)
        sync_gate_tasks(self.kaka)
        task = self._task(truck, STEP_ARRIVE)
        self.assertEqual((task.state, task.scope_location), (TaskState.OPEN, self.kaka))

    def test_gate_tasks_never_hold_a_status(self):
        truck = self.make_truck('T-7', status='gumruk_chykysh')
        sync_gate_tasks(self.dusak)
        truck.loading_started_at = timezone.now()
        truck.save()  # the ordinary Sheet path still advances with a gate task open
        truck.refresh_from_db()
        self.assertEqual(truck.status.code, 'yuklenme')


class GuardTaskBoardTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def test_guard_sees_only_his_locations_gate_tasks(self):
        mine = self.make_truck('B-1')
        theirs = self.make_truck('B-2', block=self.block_k)
        sync_gate_tasks(self.kaka)
        client = APIClient()
        client.force_authenticate(user=self.guard)
        resp = client.get('/api/v1/me/tasks/?page_size=100')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['results']
        shipments = {r['shipment'] for r in rows}
        self.assertIn(mine.pk, shipments)        # synced on read
        self.assertNotIn(theirs.pk, shipments)
        row = next(r for r in rows if r['shipment'] == mine.pk)
        self.assertEqual((row['kind'], row['truck_plate'], row['scope_location']),
                         ('gate', '1535AKM', self.dusak.pk))
```

- [ ] **Step 2: Run to verify they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate_tasks --noinput`
Expected: FAIL — `ModuleNotFoundError: apps.export.services.gate_tasks`.

- [ ] **Step 3: Task model** — in `backend/apps/export/models/task.py`:

`class TaskKind`: add `GATE = 'gate', _('Gate guard task')`.

In `class Task`, after the `scope_block` field:

```python
    scope_location = models.ForeignKey(
        'core.LoadingLocation', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
        help_text='Greenhouse gate a gate task belongs to — only that '
                  'location\'s garawul sees it. Always null for other kinds.',
    )
```

In `Meta.constraints`, add after the existing one:

```python
            # One «gelmeli» and one «çykmaly» task per truck, even when two
            # guards' screens sync at the same moment (services/gate_tasks.py).
            models.UniqueConstraint(
                fields=['shipment', 'step'],
                condition=models.Q(kind='gate'),
                name='export_task_one_gate_per_shipment_step',
            ),
```

```bash
ls apps/export/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations export --name gate_tasks
./venv/Scripts/python.exe manage.py migrate export && ./venv/Scripts/python.exe manage.py showmigrations export | tail -3
```

- [ ] **Step 4: The sync** — create `backend/apps/export/services/gate_tasks.py`:

```python
"""Gate tasks: «TIR {plate} gelmeli» and «TIR {plate} çykmaly» for the guard.

Code-driven like weekly_plan / truck_allocation, not a TaskRule: a rule is
role-wide, so every guard would see every location's trucks, and an
ALL_FIELDS_FILLED rule would hold the document team's auto-advance until the
truck arrived. MANUAL_DONE + a non-status `step` keeps these tasks out of
resolve_for_shipment() and is_step_trigger_satisfied() entirely.

sync_gate_tasks() makes the tasks equal the gate lists. It runs lazily — on
every gate list read, on My Tasks for a guard, and inside each gate action.

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.4
"""
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.roles import GATE_GUARD_ROLE
from apps.export.models import (
    Shipment, Task, TaskCancelReason, TaskCompletionRule, TaskKind, TaskState,
)
from apps.export.services.gate import expected, inside

STEP_ARRIVE = 'gate_arrive'
STEP_DEPART = 'gate_depart'
TITLE_KEYS = {STEP_ARRIVE: 'tasks.gate_arrive', STEP_DEPART: 'tasks.gate_depart'}
LINK = '/export/gate'
UNIQUE_GATE_TASK = 'export_task_one_gate_per_shipment_step'
_LIVE = (TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED)


def sync_gate_tasks(location, *, shipment_id: int | None = None, actor=None) -> None:
    """Open, close or cancel gate tasks at `location` to match the lists.

    `actor` is credited as completed_by — the gate action passes the guard; a
    read-time sync passes nothing, so a close it merely discovers (a time fixed
    on the Sheet) credits nobody.
    """
    exp = expected(location)
    ins = inside(location)
    live = Task.objects.filter(kind=TaskKind.GATE, scope_location=location, state__in=_LIVE)
    if shipment_id is not None:
        exp = exp.filter(pk=shipment_id)
        ins = ins.filter(pk=shipment_id)
        live = live.filter(shipment_id=shipment_id)
    exp_ids = set(exp.values_list('pk', flat=True))
    ins_ids = set(ins.values_list('pk', flat=True))
    ids = exp_ids | ins_ids | set(live.values_list('shipment_id', flat=True))
    if not ids:
        return

    tasks = {
        (t.shipment_id, t.step): t
        for t in Task.objects.filter(kind=TaskKind.GATE, shipment_id__in=ids)
    }
    departed = set(
        Shipment.objects.filter(pk__in=ids, departed_at__isnull=False).values_list('pk', flat=True)
    )
    now = timezone.now()
    for sid in ids:
        arrive_task = tasks.get((sid, STEP_ARRIVE))
        depart_task = tasks.get((sid, STEP_DEPART))
        if sid in exp_ids:
            _open(arrive_task, sid, STEP_ARRIVE, location)
            _cancel(depart_task, location)          # an undone arrival takes its exit back
        elif sid in ins_ids:
            _done(arrive_task, sid, STEP_ARRIVE, location, actor, now)
            _open(depart_task, sid, STEP_DEPART, location)
        elif sid in departed:
            _done(depart_task, sid, STEP_DEPART, location, actor, now)
            _cancel(arrive_task, location)
        else:
            _cancel(arrive_task, location)
            _cancel(depart_task, location)


def _create(**fields) -> None:
    try:
        with transaction.atomic():
            Task.objects.create(**fields)
    except IntegrityError as exc:
        if UNIQUE_GATE_TASK not in str(exc):
            raise


def _base(shipment_id: int, step: str, location) -> dict:
    return {
        'kind': TaskKind.GATE, 'shipment_id': shipment_id, 'step': step,
        'title_key': TITLE_KEYS[step], 'assignee_role': GATE_GUARD_ROLE,
        'scope_location': location, 'completion_rule': TaskCompletionRule.MANUAL_DONE,
        'link': LINK,
    }


def _open(task, shipment_id: int, step: str, location) -> None:
    if task is None:
        _create(**_base(shipment_id, step, location))
        return
    if task.state in _LIVE and task.scope_location_id == location.pk:
        return
    task.state = TaskState.OPEN
    task.scope_location = location
    task.cancelled_reason = ''
    task.started_at = None
    task.completed_at = None
    task.completed_by = None
    task.save(update_fields=[
        'state', 'scope_location', 'cancelled_reason', 'started_at', 'completed_at', 'completed_by',
    ])


def _done(task, shipment_id: int, step: str, location, actor, now) -> None:
    if task is None:
        if actor is not None:  # only the mark itself earns a task it never had
            _create(**_base(shipment_id, step, location), state=TaskState.DONE,
                    started_at=now, completed_at=now, completed_by=actor)
        return
    if task.state == TaskState.DONE:
        return
    task.state = TaskState.DONE
    task.scope_location = location
    task.cancelled_reason = ''
    task.started_at = task.started_at or now
    task.completed_at = now
    task.completed_by = actor
    task.save(update_fields=[
        'state', 'scope_location', 'cancelled_reason', 'started_at', 'completed_at', 'completed_by',
    ])


def _cancel(task, location) -> None:
    if task is None or task.state not in _LIVE or task.scope_location_id != location.pk:
        return
    task.state = TaskState.CANCELLED
    task.cancelled_reason = TaskCancelReason.RULE_MISMATCH
    task.save(update_fields=['state', 'cancelled_reason'])
```

- [ ] **Step 5: Wire the sync into the actions** — in `services/gate.py`, add inside each action's `with transaction.atomic():` block, as its last statement (after `_save_audited(...)` / `_notify_arrival(...)`):

```python
        _sync_tasks(location, shipment_id, user)
```

and add the helper (lazy import: `gate_tasks` imports this module):

```python
def _sync_tasks(location, shipment_id: int, user) -> None:
    from apps.export.services.gate_tasks import sync_gate_tasks
    sync_gate_tasks(location, shipment_id=shipment_id, actor=user)
```

- [ ] **Step 6: My Tasks for a guard** — `backend/apps/core/views_me.py`, `MeTaskListView.get`:

After `resolve_truck_allocation_tasks()`:

```python
        # Gate tasks are code-driven too — sync the guard's own gate on read.
        from apps.core.roles import GATE_GUARD_ROLE
        guard_location_id = getattr(request.user, 'loading_location_id', None)
        if role == GATE_GUARD_ROLE and guard_location_id:
            from apps.export.services.gate_tasks import sync_gate_tasks
            sync_gate_tasks(request.user.loading_location)
```

In the `if not is_supervisor:` branch, after the existing two `.filter(...)` calls:

```python
            if role == GATE_GUARD_ROLE:
                # One guard per gate: another location's trucks are not his work.
                qs = (
                    qs.filter(scope_location_id=guard_location_id)
                    if guard_location_id else qs.none()
                )
```

Add `'scope_location'` to the `select_related(...)` call.

- [ ] **Step 7: Serializer** — `backend/apps/export/serializers.py`, `TaskListSerializer` (another session edits this file — commit only your hunks). After `scope_block_code`:

```python
    # Gate tasks (kind='gate'): the plate the card shows and the gate it
    # belongs to (a supervisor's card sends it as ?location=).
    truck_plate = serializers.CharField(
        source='shipment.truck_plate', read_only=True, default=None,
    )
```

In `Meta.fields`, after `'scope_block_code',` add `'scope_location',` and `'truck_plate',`.

- [ ] **Step 8: Run the tests**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate_tasks apps.export.tests_gate apps.export.tests_packing_part_tasks apps.core --noinput`
Expected: all OK (the `apps.core` label covers the My Tasks tests).

- [ ] **Step 9: Commit** (with approval)

```bash
git add backend/apps/export/models/task.py backend/apps/export/migrations/*_gate_tasks.py backend/apps/export/services/gate_tasks.py backend/apps/export/services/gate.py backend/apps/core/views_me.py backend/apps/export/tests_gate_tasks.py
git add -p backend/apps/export/serializers.py   # only the TaskListSerializer hunks
git commit -m "feat(p3): gate tasks on the guard's board, scoped to his location"
```

---

### Task 6: Gate API endpoint

**Files:**
- Create: `backend/apps/export/views_gate.py`
- Modify: `backend/apps/export/urls.py`
- Test: `backend/apps/export/tests_gate_api.py`

**Interfaces:**
- Consumes: `gate.*` (Tasks 3–4), `sync_gate_tasks` (Task 5), resource `gate` (Task 2).
- Produces: `GET /api/v1/export/gate/` → `{location: {id, name}, expected: Row[], inside: Row[], recently_left: Row[]}`; `POST /api/v1/export/gate/{id}/arrive|depart/` → Row; `POST /api/v1/export/gate/{id}/undo/` body `{event}` → Row. Non-guards must send `?location=<id>`.

- [ ] **Step 1: Write the failing tests** — create `backend/apps/export/tests_gate_api.py`:

```python
"""Gate endpoint (views_gate.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.5
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.tests_gate_fixtures import GateFixtures

URL = '/api/v1/export/gate/'


class GateApiTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.make_gate_world()
        cls.admin = User.objects.create_user(username='gate_admin', password='pw', role='admin')
        cls.transport = User.objects.create_user(username='gate_tr', password='pw', role='transport')
        cls.unbound = User.objects.create_user(username='gate_nl', password='pw', role='garawul')

    def _as(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_guard_gets_his_own_location_and_ignores_the_param(self):
        mine = self.make_truck('P-1')
        self.make_truck('P-2', block=self.block_k)
        resp = self._as(self.guard).get(f'{URL}?location={self.kaka.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['location'], {'id': self.dusak.pk, 'name': 'Dusak'})
        self.assertEqual([r['id'] for r in resp.data['expected']], [mine.pk])
        self.assertEqual(resp.data['inside'], [])
        self.assertEqual(resp.data['recently_left'], [])

    def test_admin_picks_a_location(self):
        truck = self.make_truck('P-3', block=self.block_k)
        resp = self._as(self.admin).get(f'{URL}?location={self.kaka.pk}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r['id'] for r in resp.data['expected']], [truck.pk])

    def test_admin_without_location_is_400(self):
        resp = self._as(self.admin).get(URL)
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'location_required'}))

    def test_guard_without_location_is_400(self):
        resp = self._as(self.unbound).get(URL)
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'no_location'}))

    def test_role_without_the_grant_is_403(self):
        self.assertEqual(self._as(self.transport).get(f'{URL}?location={self.dusak.pk}').status_code, 403)
        truck = self.make_truck('P-4')
        resp = self._as(self.transport).post(f'{URL}{truck.pk}/arrive/?location={self.dusak.pk}')
        self.assertEqual(resp.status_code, 403)

    def test_guard_cannot_reach_the_shipment_list(self):
        self.assertEqual(self._as(self.guard).get('/api/v1/export/shipments/').status_code, 403)

    def test_arrive_then_undo_round_trip(self):
        truck = self.make_truck('P-5', status='gumruk_girish')
        client = self._as(self.guard)
        resp = client.post(f'{URL}{truck.pk}/arrive/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNotNone(resp.data['greenhouse_arrived_at'])
        self.assertTrue(resp.data['can_undo'])
        resp = client.post(f'{URL}{truck.pk}/undo/', {'event': 'arrive'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsNone(resp.data['greenhouse_arrived_at'])

    def test_refused_mark_is_409_with_a_code(self):
        truck = self.make_truck('P-6')
        resp = self._as(self.guard).post(f'{URL}{truck.pk}/depart/')
        self.assertEqual((resp.status_code, resp.data), (409, {'error': 'not_inside'}))

    def test_bad_undo_event_is_400(self):
        truck = self.make_truck('P-7')
        resp = self._as(self.guard).post(f'{URL}{truck.pk}/undo/', {'event': 'x'}, format='json')
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'bad_event'}))

    def test_unknown_truck_is_404(self):
        resp = self._as(self.guard).post(f'{URL}999999/arrive/')
        self.assertEqual((resp.status_code, resp.data), (404, {'error': 'not_found'}))
```

- [ ] **Step 2: Run to verify they fail**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate_api --noinput`
Expected: FAIL — 404 on `/api/v1/export/gate/`.

- [ ] **Step 3: The view** — create `backend/apps/export/views_gate.py`:

```python
"""Gate guard endpoint — thin wrapper over services/gate.py.

GET  /api/v1/export/gate/                 — the guard's three lists
POST /api/v1/export/gate/{id}/arrive/     — «Ýyladyşhana geldi»
POST /api/v1/export/gate/{id}/depart/     — «Ýyladyşhanadan çykdy»
POST /api/v1/export/gate/{id}/undo/       — {"event": "arrive" | "depart"}

A guard always works his own User.loading_location; any ?location= he sends
is ignored. Other roles holding the `gate` grant (admin, boss) must send one.
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.core.models import LoadingLocation
from apps.core.permissions import DynamicResourcePermission, resource_edit_permission
from apps.core.roles import GATE_GUARD_ROLE
from apps.export.models import Shipment
from apps.export.services import gate
from apps.export.services.gate_tasks import sync_gate_tasks

UNDO_EVENTS = ('arrive', 'depart')


class _LocationError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _location_for(request) -> LoadingLocation:
    user = request.user
    if getattr(user, 'role', None) == GATE_GUARD_ROLE:
        if user.loading_location_id is None:
            raise _LocationError('no_location')
        return user.loading_location
    raw = request.query_params.get('location')
    if not raw:
        raise _LocationError('location_required')
    try:
        return LoadingLocation.objects.get(pk=int(raw))
    except (ValueError, LoadingLocation.DoesNotExist) as exc:
        raise _LocationError('bad_location') from exc


def _error(code: str, http_status: int) -> Response:
    return Response({'error': code}, status=http_status)


class GateViewSet(ViewSet):
    resource_code = 'gate'

    def get_permissions(self):
        if self.action == 'list':
            return [IsAuthenticated(), DynamicResourcePermission()]
        # POSTs edit an existing truck — gate on can_edit, not can_create.
        return [IsAuthenticated(), resource_edit_permission('gate')()]

    def list(self, request):
        try:
            location = _location_for(request)
        except _LocationError as exc:
            return _error(exc.code, status.HTTP_400_BAD_REQUEST)
        sync_gate_tasks(location)
        now = timezone.now()
        return Response({
            'location': {'id': location.pk, 'name': location.name},
            'expected': [gate.gate_row(s, now=now) for s in gate.expected(location)],
            'inside': [gate.gate_row(s, 'arrive', now) for s in gate.inside(location)],
            'recently_left': [
                gate.gate_row(s, 'depart', now) for s in gate.recently_left(location, now)
            ],
        })

    @action(detail=True, methods=['post'])
    def arrive(self, request, pk=None):
        return self._act(request, pk, 'arrive', lambda sid, loc: gate.arrive(sid, loc, request.user))

    @action(detail=True, methods=['post'])
    def depart(self, request, pk=None):
        return self._act(request, pk, 'depart', lambda sid, loc: gate.depart(sid, loc, request.user))

    @action(detail=True, methods=['post'])
    def undo(self, request, pk=None):
        event = request.data.get('event')
        if event not in UNDO_EVENTS:
            return _error('bad_event', status.HTTP_400_BAD_REQUEST)
        return self._act(request, pk, None, lambda sid, loc: gate.undo(sid, loc, request.user, event))

    def _act(self, request, pk, undo_event, run) -> Response:
        try:
            location = _location_for(request)
        except _LocationError as exc:
            return _error(exc.code, status.HTTP_400_BAD_REQUEST)
        try:
            shipment_id = int(pk)
        except (TypeError, ValueError):
            return _error('not_found', status.HTTP_404_NOT_FOUND)
        try:
            shipment = run(shipment_id, location)
        except Shipment.DoesNotExist:
            return _error('not_found', status.HTTP_404_NOT_FOUND)
        except gate.GateError as exc:
            return _error(exc.code, status.HTTP_409_CONFLICT)
        return Response(gate.gate_row(shipment, undo_event))
```

- [ ] **Step 4: Route it** — `backend/apps/export/urls.py`: import `from apps.export.views_gate import GateViewSet` and, after `router.register('tasks', TaskViewSet, basename='task')`:

```python
router.register('gate', GateViewSet, basename='gate')
```

- [ ] **Step 5: Run the tests**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_gate_api apps.export.tests_gate apps.export.tests_gate_tasks --noinput`
Expected: all OK.

- [ ] **Step 6: Commit** (with approval)

```bash
git add backend/apps/export/views_gate.py backend/apps/export/urls.py backend/apps/export/tests_gate_api.py
git commit -m "feat(p3): gate endpoint for the guard's lists and marks"
```

---

### Task 7: Sheet row «Ýyladyşhana geldi»

**Files:**
- Modify: `backend/apps/export/sheet_rows.py`, `backend/apps/export/serializers.py` (two field lists), `backend/apps/core/permission_registry.py` (`RESOURCE_FIELDS['shipment']`), `backend/apps/core/management/commands/seed_permissions.py` (`FIELD_DEFAULTS`), `backend/apps/export/services/comments.py` (`SHEET_FIELD_KEYS`), `backend/apps/export/management/commands/backfill_sheet_row_defaults.py` (`WHO_TO_ROLE`)
- Create: export data migration `seed_greenhouse_arrival_row`
- Modify (frontend, same task — the drift tests span both sides): `frontend/src/types/index.ts` (`IShipmentSheetItem`), `frontend/src/components/sheet/getCellValue.ts`, `frontend/src/components/sheet/sheetRoleBlocks.ts`, `frontend/src/components/sheet/sheetTopicOrder.ts`, `frontend/src/mock/shipmentSheet.ts`, `frontend/src/i18n/{tk,ru,en}.json`
- Test: `backend/apps/export/tests_greenhouse_arrival_row.py`

**Interfaces:**
- Consumes: `Shipment.greenhouse_arrived_at` (Task 3).
- Produces: Sheet row 49, `field_key='greenhouse_arrived_at'`, `default_who_key='sheet.who.garawul'`, `label_key='sheet.row.greenhouse_arrival'`, `input_type='datetime'`; editable by admin + wildcard roles + `loading_dept_head` + `loading_dept_head_deputy` (+ `boss` via trigger on live).

Decision (from planning): `WHO_TO_ROLE['garawul'] = ['loading_dept_head', 'loading_dept_head_deputy']` and frontend `'sheet.who.garawul': 'loading_dept_head'`. The caption reads «Garawul» (i18n), but the people who correct the cell are the loading roles; mapping the who-key to `garawul` would force a shipment field grant on the guard, which the spec forbids. In the classic Sheet's owner bands the row therefore renders in the loading band.

- [ ] **Step 1: Write the failing test** — create `backend/apps/export/tests_greenhouse_arrival_row.py`:

```python
"""Sheet row «Ýyladyşhana geldi» (greenhouse_arrived_at) — spec §1.6 item 4."""
from django.core.management import call_command
from django.test import TestCase

from apps.core.models import User
from apps.core.permissions import can_edit_sheet_field
from apps.export.management.commands.backfill_sheet_row_defaults import WHO_TO_ROLE
from apps.export.serializers import _ALL_PATCHABLE_FIELDS
from apps.export.services.comments import SHEET_FIELD_KEYS
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


class GreenhouseArrivalRowTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def _row(self) -> dict:
        return next(r for r in DEFAULT_SHEET_ROWS if r['field_key'] == 'greenhouse_arrived_at')

    def test_row_shape(self):
        row = self._row()
        self.assertEqual(row['row_number'], 49)
        self.assertEqual(row['input_type'], 'datetime')
        self.assertEqual(row['default_who_key'], 'sheet.who.garawul')
        self.assertEqual(row['label_key'], 'sheet.row.greenhouse_arrival')
        self.assertFalse(row.get('gapy_hidden', False))  # gapy trucks pass the gate too

    def test_row_sits_right_after_greenhouse_departure(self):
        keys = [r['field_key'] for r in DEFAULT_SHEET_ROWS]
        self.assertEqual(keys.index('greenhouse_arrived_at'), keys.index('departed_at') + 1)

    def test_field_is_patchable_and_commentable(self):
        self.assertIn('greenhouse_arrived_at', _ALL_PATCHABLE_FIELDS)
        self.assertIn('greenhouse_arrived_at', SHEET_FIELD_KEYS)

    def test_loading_roles_edit_it_and_the_guard_does_not(self):
        self.assertEqual(WHO_TO_ROLE['garawul'], ['loading_dept_head', 'loading_dept_head_deputy'])
        for role in ('loading_dept_head', 'loading_dept_head_deputy'):
            with self.subTest(role=role):
                user = User.objects.create_user(username=f'arr_{role}', password='pw', role=role)
                self.assertTrue(can_edit_sheet_field(user, 'greenhouse_arrived_at'))
        guard = User.objects.create_user(username='arr_guard', password='pw', role='garawul')
        self.assertFalse(can_edit_sheet_field(guard, 'greenhouse_arrived_at'))
```

- [ ] **Step 2: Run the baseline and the new test**

Run: `./venv/Scripts/python.exe manage.py test apps.export.tests_sheet_perms.TestEveryRoleCanEditItsOwnSheetRow apps.export.tests_greenhouse_arrival_row --noinput`
Expected: `TestEveryRoleCanEditItsOwnSheetRow` PASSES (baseline, memory "Sheet Permission Fix Verification"); the new test FAILS (`StopIteration`).

- [ ] **Step 3: Backend edits**

1. `backend/apps/export/sheet_rows.py` — directly after the R21 dict (`'field_key': 'departed_at'`):

```python
    {
        # Gate arrival (garawul, 2026-09-29). The guard stamps it from the gate
        # screen; this row shows it and lets the loading head correct it.
        'row_number': 49,
        'field_key': 'greenhouse_arrived_at',
        'default_who_key': 'sheet.who.garawul',
        'label_key': 'sheet.row.greenhouse_arrival',
        'input_type': 'datetime',
        'style': 'base',
    },
```

2. `backend/apps/export/serializers.py` (shared-dirty file — hunks only):
   - `_ALL_PATCHABLE_FIELDS`, "Operator-entered timestamps" block: add `'greenhouse_arrived_at',` on the line after `'departed_at',`.
   - `ShipmentSheetSerializer.Meta.fields`: add `'greenhouse_arrived_at',` after `'departed_at',` in the timestamps line.
3. `backend/apps/core/permission_registry.py` `RESOURCE_FIELDS['shipment']`: add `'greenhouse_arrived_at',` after `'departed_at',` (without it `/admin/permissions` Save drops the grant).
4. `seed_permissions.py` `FIELD_DEFAULTS['loading_dept_head']['shipment']`: add `'greenhouse_arrived_at',` after `'departed_at',` (the deputy is a deep copy).
5. `backend/apps/export/services/comments.py` `SHEET_FIELD_KEYS`: add `'greenhouse_arrived_at',` after `'departed_at',`. Leave `_VALID_ROLES` alone.
6. `backfill_sheet_row_defaults.py` `WHO_TO_ROLE`: add `'garawul': ['loading_dept_head', 'loading_dept_head_deputy'],` after the `'quality'` entry.

- [ ] **Step 4: Live-DB data migration**

```bash
ls apps/export/migrations | tail -3 ; ls apps/core/migrations | tail -3 ; git log --oneline -5
./venv/Scripts/python.exe manage.py makemigrations export --empty --name seed_greenhouse_arrival_row
```

Body (keep generated export dependency; add the core `seed_garawul_perms` migration as a second dependency by its generated name):

```python
"""Put Sheet row «Ýyladyşhana geldi» (greenhouse_arrived_at) on the live DB.

Production runs `migrate` only, never seed_permissions, so:
  - the loading roles' RoleFieldPermission grant is written here, and
  - the SheetRowSetting row + its triggers are written here. Once a row has any
    trigger, the triggers ARE the permission (AD-17), so boss needs his own —
    he holds shipment:* but is not in SHEET_BYPASS_ROLES.
display_order = midpoint between R21 and the next row, read at migrate time
(admins may have reordered). Does NOT call backfill(): that would re-copy grants
across every row and undo triggers an admin removed. Idempotent, reversible.
"""
import os

from django.db import migrations

FIELD_KEY = 'greenhouse_arrived_at'
EDITORS = ['loading_dept_head', 'loading_dept_head_deputy']
TRIGGER_ROLES = EDITORS + ['boss']


def seed(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowRoleTrigger = apps.get_model('export', 'SheetRowRoleTrigger')

    for role in EDITORS:
        RoleFieldPermission.objects.get_or_create(
            role=role, resource_code='shipment', field_name=FIELD_KEY,
        )

    departure = SheetRowSetting.objects.filter(field_key='departed_at').first()
    if departure is None:
        display_order, is_locked = 49 * 1024, False
    else:
        after = (
            SheetRowSetting.objects.filter(display_order__gt=departure.display_order)
            .order_by('display_order').values_list('display_order', flat=True).first()
        )
        upper = after if after is not None else departure.display_order + 1024
        display_order = (departure.display_order + upper) // 2
        is_locked = departure.is_locked
    row, _ = SheetRowSetting.objects.get_or_create(
        field_key=FIELD_KEY,
        defaults={'row_number': 49, 'display_order': display_order, 'is_locked': is_locked},
    )
    for role in TRIGGER_ROLES:
        SheetRowRoleTrigger.objects.get_or_create(row=row, role=role)
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    apps.get_model('export', 'SheetRowSetting').objects.filter(field_key=FIELD_KEY).delete()
    apps.get_model('core', 'RoleFieldPermission').objects.filter(field_name=FIELD_KEY).delete()
    _wipe_perm_cache()


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        # 1. the export dependency makemigrations generated (keep as is), and
        # 2. the core migration Task 2 created — copy its exact name, e.g.
        #    ('core', '0067_seed_garawul_perms') if that is what Task 2 produced.
    ]

    operations = [migrations.RunPython(seed, reverse_code=unseed)]
```

If a midpoint collides (two rows 1 apart), still create the row — `display_order` is not unique; the Row access tab can reorder it. Then `migrate export` + `showmigrations export | tail -3`.

- [ ] **Step 5: Frontend edits**

1. `types/index.ts` `IShipmentSheetItem`: after `departed_at: string | null;` add `greenhouse_arrived_at: string | null;`.
2. `components/sheet/getCellValue.ts` `tsFields`: add `'greenhouse_arrived_at',` after `'departed_at',`.
3. `components/sheet/sheetRoleBlocks.ts` `WHO_KEY_ROLE`: add `'sheet.who.garawul': 'loading_dept_head',`.
4. `components/sheet/sheetTopicOrder.ts`, loading-times `fields`: add `'greenhouse_arrived_at',` after `'departed_at',`.
5. `mock/shipmentSheet.ts`: add `greenhouse_arrived_at: null,` next to each `transport_docs_given_at: null` (5 objects).
6. i18n — `sheet.who` block: tk `"garawul": "Garawul"`, ru `"garawul": "Охранник"`, en `"garawul": "Gate guard"`. `sheet.row` block, after `greenhouse_departure`: tk `"greenhouse_arrival": "Ýyladyşhana geldi"`, ru `"greenhouse_arrival": "Прибыл в теплицу"`, en `"greenhouse_arrival": "Arrived at greenhouse"`.

- [ ] **Step 6: Run everything the row touches**

```bash
cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_greenhouse_arrival_row apps.export.tests_sheet_perms apps.export.tests_sheet_row_role_group apps.export.tests_sheet_topic_order apps.export.tests_sheet_authority apps.export.tests_shipment_sheet apps.export.tests_comments --noinput
cd ../frontend && npx vitest run src/components/sheet && npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: all OK, including `TestEveryRoleCanEditItsOwnSheetRow` (after). `sheetRoleBlocks.test.ts` `SERVER_ORDER` may be updated for accuracy (optional; it does not fail).

- [ ] **Step 7: Commit** (with approval — `serializers.py`, `seed_permissions.py`, `permission_registry.py` via `git add -p`)

```bash
git add backend/apps/export/sheet_rows.py backend/apps/export/services/comments.py backend/apps/export/management/commands/backfill_sheet_row_defaults.py backend/apps/export/migrations/*_seed_greenhouse_arrival_row.py backend/apps/export/tests_greenhouse_arrival_row.py frontend/src/components/sheet/getCellValue.ts frontend/src/components/sheet/sheetRoleBlocks.ts frontend/src/components/sheet/sheetTopicOrder.ts frontend/src/mock/shipmentSheet.ts
git add -p backend/apps/export/serializers.py backend/apps/core/permission_registry.py backend/apps/core/management/commands/seed_permissions.py frontend/src/types/index.ts frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(p3): Sheet row «Ýyladyşhana geldi» for the gate arrival time"
```

---

### Task 8: Frontend role plumbing

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/constants/roles.ts`, `frontend/src/pages/admin/permissions/roleColors.ts`, `frontend/src/pages/admin/StaffPageAccessPage.tsx`, `frontend/src/pages/admin/UsersPage.tsx`, `frontend/src/hooks/useAdmin.ts`, `frontend/src/utils/permissions.ts`, `frontend/src/components/NotificationBell.tsx`, `frontend/src/pages/export/TaskRulesPage.tsx`, `frontend/src/i18n/{tk,ru,en}.json`
- Test: `frontend/src/utils/permissions.test.ts` (append or create), `frontend/src/pages/export/TaskRulesPage.test.tsx` (append)

**Interfaces:**
- Produces (types): `UserRole` gains `'garawul'`; `TaskKind` gains `'gate'`; `ITaskListItem` gains `truck_plate: string | null` and `scope_location: number | null`; `INotification['kind']` gains `'gate_arrival'`; `IAdminUser` gains `loading_location: number | null`; new `IGateRow`, `IGateBoard` (below).

- [ ] **Step 1: Write the failing tests**

`frontend/src/utils/permissions.test.ts` (append a `describe`; create the file with these imports if absent):

```ts
import { describe, it, expect } from 'vitest';
import { canSeePage } from '@/utils/permissions';
import type { ICurrentUser } from '@/types';

function guard(pages: Record<string, boolean>): ICurrentUser {
  return {
    id: 1, username: 'g', email: '', first_name: '', last_name: '', role: 'garawul',
    is_superuser: false, managed_block_ids: [], permissions: [], page_permissions: pages,
    resource_permissions: {}, field_permissions: {}, active_season: null,
    can_view_closed_seasons: false,
  };
}

describe('gate route', () => {
  it('maps /export/gate to the export.gate page code', () => {
    expect(canSeePage(guard({ 'export.gate': true }), '/export/gate')).toBe(true);
    expect(canSeePage(guard({ 'export.gate': false }), '/export/gate')).toBe(false);
  });
});
```

`TaskRulesPage.test.tsx` — add:

```tsx
  it('lists the gate guard kind among the code-driven tasks', () => {
    renderPage([rule()]);
    expect(screen.getByText('Gate guard: mark arrival and exit')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/utils/permissions.test.ts src/pages/export/TaskRulesPage.test.tsx`
Expected: FAIL (type error on `'garawul'`; text not found).

- [ ] **Step 3: Types** — `types/index.ts`:
- `UserRole` union: add `| 'garawul'`.
- `export type TaskKind = 'shipment' | 'weekly_plan' | 'local_sell_plan' | 'truck_allocation' | 'gate';`
- `ITaskListItem`, after `scope_block_code`:

```ts
  /** Gate location a gate task belongs to; null for other kinds. */
  scope_location: number | null;
  /** Truck plate (gate task cards); null when the shipment has none. */
  truck_plate: string | null;
```

- `INotification['kind']`: add `| 'gate_arrival'`.
- `IAdminUser`: add `loading_location: number | null;`.
- Append:

```ts
// ─── Gate guard (garawul) ────────────────────────────────────────────────────

/** One truck as the gate guard sees it — GET /export/gate/. */
export interface IGateRow {
  id: number;
  shipment_code: string;
  truck_plate: string | null;
  truck_plate_2: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  date: string;
  is_gapy_satys: boolean;
  status_code: string;
  greenhouse_arrived_at: string | null;
  departed_at: string | null;
  can_undo: boolean;
}

export interface IGateBoard {
  location: { id: number; name: string };
  expected: IGateRow[];
  inside: IGateRow[];
  recently_left: IGateRow[];
}
```

Fix any object literal of `ITaskListItem` / `IAdminUser` that `tsc` now flags (mocks, tests, `useAdmin.ts` `USE_MOCK` branch: add `loading_location: null`).

- [ ] **Step 4: Role lists**
- `constants/roles.ts` `ROLE_CHOICES`: add `{ value: 'garawul', labelKey: 'roles.garawul' },` before `boss`.
- `pages/admin/permissions/roleColors.ts`: add `garawul: 'magenta',  // must match UsersPage's ROLE_COLORS`.
- `UsersPage.tsx`: add `'garawul',` to `ALL_ROLES` before `'boss'`; `ROLE_COLORS`: `garawul: 'magenta',`.
- `StaffPageAccessPage.tsx` role color map: `garawul: 'magenta',`.
- `utils/permissions.ts` `ROUTE_PAGE_MAP`: `'/export/gate': 'export.gate',`.

- [ ] **Step 5: Users page — gate location**

`hooks/useAdmin.ts`: `useUpdateUserRole` accepts and sends `loading_location?: number | null` (add to the destructured params and the PATCH body); `ICreateUserPayload` gains `loading_location?: number | null;`.

`UsersPage.tsx`: add `loading_location: number | null;` to `IUserEditFormValues`; call `const { data: locations = [] } = useLoadingLocations();` (import from `@/hooks/useAdmin`); `handleOpenEdit` sets `loading_location: record.loading_location`; `handleEditSubmit` sends `loading_location: values.role === 'garawul' ? values.loading_location : null`. In **both** forms, directly after the role `Form.Item`:

```tsx
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.role !== cur.role}>
            {({ getFieldValue }) =>
              getFieldValue('role') === 'garawul' ? (
                <Form.Item
                  name="loading_location"
                  label={t('users_admin.loading_location')}
                  rules={[{ required: true, message: t('common.required') }]}
                >
                  <Select options={locations.map((l) => ({ value: l.id, label: l.name }))} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
```

- [ ] **Step 6: Notification + Task Rules**
- `NotificationBell.tsx`, next to the `weekly_plan_summary` line: `if (n.kind === 'gate_arrival') return `${t('notifications.gate_arrival')} ${n.message}`;`
- `TaskRulesPage.tsx`: update the doc comment ("The four task kinds…") and add `{ key: 'gate', role: 'garawul' },` to `CODE_DRIVEN_KINDS`.

- [ ] **Step 7: i18n** (all three files)
- `roles`: tk `"garawul": "Garawul"`, ru `"garawul": "Охранник"`, en `"garawul": "Gate guard"`.
- `users_admin.loading_location`: tk `"Derwezäniň ýeri"`, ru `"Место КПП"`, en `"Gate location"`.
- `notifications.gate_arrival`: tk `"Maşyn ýyladyşhana geldi:"`, ru `"Машина прибыла в теплицу:"`, en `"Truck arrived at the greenhouse:"`.
- `tasks.gate_arrive`: tk `"{{plate}} gelmeli — gelenini belläň"`, ru `"Ожидается {{plate}} — отметьте прибытие"`, en `"Truck {{plate}} is due — mark arrival"`.
- `tasks.gate_depart`: tk `"{{plate}} ýyladyşhanada — çykanyny belläň"`, ru `"{{plate}} на территории — отметьте выезд"`, en `"Truck {{plate}} is inside — mark exit"`.
- `task_rules.kind_gate_name`: tk `"Garawul: gelen we çykan maşynlary bellemek"`, ru `"Охранник: отметить прибытие и выезд"`, en `"Gate guard: mark arrival and exit"`.
- `task_rules.kind_gate_trigger`: tk `"Belgili maşyn garawulyň ýerine gelmeli bolanda (şu gün −7 … ertir)"`, ru `"Когда машина с номером ожидается на его площадке (сегодня −7 … завтра)"`, en `"When a plated truck is due at his location (today −7 … tomorrow)"`.
- `task_rules.kind_gate_completes`: tk `"Derwezede «Geldi» / «Çykdy» basylanda"`, ru `"Когда на КПП нажато «Прибыл» / «Выехал»"`, en `"When «Arrived» / «Left» is tapped at the gate"`.
- `task_rules.other_kinds_intro` says "three" kinds — rewrite to four: tk `"Dört görnüş ýumuş ýokardaky düzgünden däl-de, öz kody we öz tertibi boýunça döreýär. Kaýbir rollar üçin diňe şular bar — ýyladyşhana müdiriniň ähli nobaty birinji setir, garawulyňky soňky setir."`, ru `"Четыре вида задач создаются собственным кодом по своему расписанию, а не правилом выше. Для некоторых ролей это единственные задачи — вся очередь менеджера теплицы это первая строка, охранника — последняя."`, en `"Four task kinds are generated by their own code on their own schedule, not by a rule above. They are the only tasks some roles ever get — a greenhouse manager's whole queue is the first row, a gate guard's the last."`. If `TaskRulesPage.test.tsx` asserts the old sentence, update it.

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/utils/permissions.test.ts src/pages/export/TaskRulesPage.test.tsx src/pages/admin && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, 0 type errors.

- [ ] **Step 9: Commit** (with approval; `types/index.ts` and the i18n files via `git add -p` if other sessions dirtied them)

```bash
git add frontend/src/constants/roles.ts frontend/src/pages/admin/permissions/roleColors.ts frontend/src/pages/admin/StaffPageAccessPage.tsx frontend/src/pages/admin/UsersPage.tsx frontend/src/hooks/useAdmin.ts frontend/src/utils/permissions.ts frontend/src/utils/permissions.test.ts frontend/src/components/NotificationBell.tsx frontend/src/pages/export/TaskRulesPage.tsx frontend/src/pages/export/TaskRulesPage.test.tsx
git add -p frontend/src/types/index.ts frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): garawul role, gate location on users, gate task kind"
```

---

### Task 9: Gate page `/export/gate`

**Files:**
- Create: `frontend/src/utils/plateSearch.ts`, `frontend/src/utils/plateSearch.test.ts`
- Create: `frontend/src/hooks/useGate.ts`
- Create: `frontend/src/components/gate/GateTruckCard.tsx`, `frontend/src/components/gate/GateConfirmModal.tsx`
- Create: `frontend/src/pages/export/GatePage.tsx`, `frontend/src/pages/export/GatePage.test.tsx`
- Create: `frontend/src/pages/IndexRoute.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/AppLayout.tsx` (shared-dirty — hunks only), `frontend/src/i18n/{tk,ru,en}.json`

**Interfaces:**
- Consumes: `IGateRow`, `IGateBoard` (Task 8); endpoint (Task 6).
- Produces: `normalizePlate(value: string): string`; `plateMatches(query: string, ...plates: (string | null | undefined)[]): boolean`; `type GateAction = 'arrive' | 'depart' | 'undo_arrive' | 'undo_depart'`; `useGateBoard(locationId: number | null, enabled: boolean)`; `useGateAction()` (mutation variables `{ id: number; action: GateAction; locationId: number | null }`); `gateErrorCode(error: unknown): string | null`; `<GateConfirmModal pending loading onConfirm onCancel />`; `<GateTruckCard row primaryAction? undoAction? muted? onAction />`.

- [ ] **Step 1: Failing search tests** — `frontend/src/utils/plateSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePlate, plateMatches } from './plateSearch';

describe('plate search', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizePlate(' 1535 akm-2 ')).toBe('1535AKM2');
  });

  it('folds Cyrillic look-alikes typed on a Russian keyboard', () => {
    expect(plateMatches('1535 акм', '1535AKM/2256TAH')).toBe(true);
    expect(plateMatches('ВЕНОРСТХ', 'BEHOPCTX')).toBe(true);
  });

  it('matches either plate and treats an empty query as a match', () => {
    expect(plateMatches('2256', '1535AKM', '2256TAH')).toBe(true);
    expect(plateMatches('9999', '1535AKM', null)).toBe(false);
    expect(plateMatches('', null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/utils/plateSearch.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `frontend/src/utils/plateSearch.ts`:

```ts
/**
 * Plate search for the gate guard. Guards type on phones with a Russian
 * keyboard, so Cyrillic letters that look like Latin plate letters are folded,
 * along with case, spaces and dashes.
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
};

export function normalizePlate(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВЕКМНОРСТХ]/g, (ch) => LOOKALIKES[ch] ?? ch);
}

export function plateMatches(query: string, ...plates: (string | null | undefined)[]): boolean {
  const needle = normalizePlate(query);
  if (!needle) return true;
  return plates.some((plate) => plate != null && normalizePlate(plate).includes(needle));
}
```

Run again → PASS.

- [ ] **Step 4: Hook** — `frontend/src/hooks/useGate.ts`:

```ts
import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { IGateBoard, IGateRow } from '@/types';

export type GateAction = 'arrive' | 'depart' | 'undo_arrive' | 'undo_depart';

/** Non-guards (admin, boss) must name the gate; a guard's own is server-side. */
function locationQuery(locationId: number | null): string {
  return locationId == null ? '' : `?location=${locationId}`;
}

function request(action: GateAction): { path: string; body: Record<string, string> } {
  if (action === 'undo_arrive') return { path: 'undo', body: { event: 'arrive' } };
  if (action === 'undo_depart') return { path: 'undo', body: { event: 'depart' } };
  return { path: action, body: {} };
}

/** The `{"error": "<code>"}` code of a failed gate call, or null. */
export function gateErrorCode(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const code = (error.response?.data as { error?: unknown } | undefined)?.error;
  return typeof code === 'string' ? code : null;
}

export function useGateBoard(locationId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['gate-board', locationId],
    queryFn: async (): Promise<IGateBoard> => {
      const { data } = await api.get<IGateBoard>(`/export/gate/${locationQuery(locationId)}`);
      return data;
    },
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useGateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, locationId }: {
      id: number; action: GateAction; locationId: number | null;
    }): Promise<IGateRow> => {
      const { path, body } = request(action);
      const { data } = await api.post<IGateRow>(
        `/export/gate/${id}/${path}/${locationQuery(locationId)}`, body,
      );
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['gate-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
```

- [ ] **Step 5: Confirm modal** — `frontend/src/components/gate/GateConfirmModal.tsx`:

```tsx
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { GateAction } from '@/hooks/useGate';

interface IGateConfirmModalProps {
  readonly pending: { plate: string; action: GateAction } | null;
  readonly loading: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Every gate tap is confirmed with the plate in large type — a status move cannot be taken back. */
export function GateConfirmModal({ pending, loading, onConfirm, onCancel }: IGateConfirmModalProps) {
  const { t } = useTranslation();
  const key = pending?.action.startsWith('undo') ? 'undo' : pending?.action;
  return (
    <Modal
      open={pending !== null}
      centered
      destroyOnClose
      title={pending ? t(`gate.confirm_${key}`, { plate: pending.plate }) : ''}
      okText={t('gate.yes')}
      cancelText={t('common.cancel')}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okButtonProps={{ size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
    />
  );
}
```

- [ ] **Step 6: Truck card** — `frontend/src/components/gate/GateTruckCard.tsx`:

```tsx
import { Button, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { GateAction } from '@/hooks/useGate';
import type { IGateRow } from '@/types';
import { COLORS } from '@/constants/styles';

dayjs.extend(utc);
dayjs.extend(timezone);
const TM_TZ = 'Asia/Ashgabat';
const { Text } = Typography;

interface IGateTruckCardProps {
  readonly row: IGateRow;
  readonly primaryAction?: 'arrive' | 'depart';
  readonly undoAction?: 'undo_arrive' | 'undo_depart';
  readonly muted?: boolean;
  readonly onAction: (row: IGateRow, action: GateAction) => void;
}

/** One truck at the gate, sized for a phone: plate first, one big button. */
export function GateTruckCard({ row, primaryAction, undoAction, muted = false, onAction }: IGateTruckCardProps) {
  const { t } = useTranslation();
  const today = dayjs().tz(TM_TZ).format('YYYY-MM-DD');
  const overdue = row.date < today;

  return (
    <div
      data-testid={`gate-card-${row.id}`}
      style={{
        background: COLORS.white,
        border: `1px solid ${COLORS.borderLight}`,
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
        opacity: muted ? 0.55 : 1,
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1, lineHeight: 1.2 }}>
        {row.truck_plate}
      </div>
      {row.truck_plate_2 && <div style={{ fontSize: 18, fontWeight: 600 }}>{row.truck_plate_2}</div>}
      <Space wrap size={6} style={{ marginTop: 6 }}>
        <Text type={overdue ? 'danger' : 'secondary'}>
          {dayjs(row.date).format('DD.MM.YYYY')}{overdue ? ` · ${t('gate.overdue')}` : ''}
        </Text>
        {row.is_gapy_satys && <Tag color="purple">{t('gate.gapy')}</Tag>}
        <Tag>{t(`shipment_status.${row.status_code}`, { defaultValue: row.status_code })}</Tag>
      </Space>
      {(row.driver_name || row.driver_phone) && (
        <div style={{ marginTop: 6, fontSize: 16 }}>
          {row.driver_name}{' '}
          {row.driver_phone && <a href={`tel:${row.driver_phone}`}>{row.driver_phone}</a>}
        </div>
      )}
      {primaryAction && (
        <Button
          type="primary"
          size="large"
          block
          onClick={() => onAction(row, primaryAction)}
          style={{ height: 56, fontSize: 18, marginTop: 12 }}
        >
          {t(`gate.${primaryAction}`)}
        </Button>
      )}
      {undoAction && row.can_undo && (
        <Button size="large" block onClick={() => onAction(row, undoAction)} style={{ marginTop: 8 }}>
          {t('gate.undo')}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Failing page tests** — `frontend/src/pages/export/GatePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import i18n from '@/i18n';
import GatePage from './GatePage';
import { useGateAction, useGateBoard } from '@/hooks/useGate';
import { useAuth } from '@/hooks/useAuth';
import { useLoadingLocations } from '@/hooks/useAdmin';
import type { IGateBoard, IGateRow } from '@/types';

vi.mock('@/hooks/useGate', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useGate')>()),
  useGateBoard: vi.fn(),
  useGateAction: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useLoadingLocations: vi.fn() }));

const mutate = vi.fn();

function row(overrides: Partial<IGateRow> = {}): IGateRow {
  return {
    id: 1, shipment_code: '0000001/26', truck_plate: '1535AKM', truck_plate_2: '2256TAH',
    driver_name: 'Aman', driver_phone: '+99365000000', date: '2099-01-01',
    is_gapy_satys: false, status_code: 'gumruk_chykysh', greenhouse_arrived_at: null,
    departed_at: null, can_undo: false, ...overrides,
  };
}

function setup(board: Partial<IGateBoard> = {}, error: unknown = null) {
  vi.mocked(useAuth).mockReturnValue({ user: { role: 'garawul' }, isLoading: false, isError: false } as ReturnType<typeof useAuth>);
  vi.mocked(useLoadingLocations).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useLoadingLocations>);
  vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
  vi.mocked(useGateBoard).mockReturnValue({
    data: error ? undefined : {
      location: { id: 1, name: 'Dusak' }, expected: [], inside: [], recently_left: [], ...board,
    },
    isLoading: false,
    isError: Boolean(error),
    error,
  } as unknown as ReturnType<typeof useGateBoard>);
  return render(<GatePage />);
}

describe('GatePage', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows expected trucks with a count and confirms before marking arrival', () => {
    setup({ expected: [row()] });
    expect(screen.getByText('Expected (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived at greenhouse' }));
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Truck 1535AKM arrived at the greenhouse?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 1, action: 'arrive', locationId: null }, expect.any(Object),
    );
  });

  it('filters by plate typed on a Russian keyboard', () => {
    setup({ expected: [row(), row({ id: 2, truck_plate: '9999BBB', truck_plate_2: null })] });
    fireEvent.change(screen.getByPlaceholderText('Search plate'), { target: { value: 'акм' } });
    expect(screen.getByTestId('gate-card-1')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-card-2')).not.toBeInTheDocument();
  });

  it('offers undo only while the server allows it', () => {
    setup({ inside: [row({ id: 3, can_undo: true }), row({ id: 4, can_undo: false })] });
    fireEvent.click(screen.getByText('Inside (2)'));
    expect(within(screen.getByTestId('gate-card-3')).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(screen.getByTestId('gate-card-4')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('explains a guard without a location', () => {
    const error = new AxiosError('bad', '400', undefined, undefined, {
      status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() },
      data: { error: 'no_location' },
    });
    setup({}, error);
    expect(screen.getByText('No location assigned to you — contact the admin.')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/pages/export/GatePage.test.tsx` → FAIL (page missing).

- [ ] **Step 8: The page** — `frontend/src/pages/export/GatePage.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Empty, Input, Segmented, Select, Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLoadingLocations } from '@/hooks/useAdmin';
import { gateErrorCode, useGateAction, useGateBoard } from '@/hooks/useGate';
import type { GateAction } from '@/hooks/useGate';
import { GateTruckCard } from '@/components/gate/GateTruckCard';
import { GateConfirmModal } from '@/components/gate/GateConfirmModal';
import { plateMatches } from '@/utils/plateSearch';
import type { IGateRow } from '@/types';

const { Title, Text } = Typography;

type GateTab = 'expected' | 'inside';

/**
 * The gate guard's screen (garawul). Built for a phone at the gate: one search
 * box, two tabs, one big button per truck, a confirm on every tap.
 * Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §2.1
 */
export default function GatePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isGuard = user?.role === 'garawul';
  const { data: locations = [] } = useLoadingLocations();
  const [pickedLocation, setPickedLocation] = useState<number | null>(null);
  const locationId = isGuard ? null : (pickedLocation ?? locations[0]?.id ?? null);
  const board = useGateBoard(locationId, isGuard || locationId !== null);
  const gateAction = useGateAction();
  const [tab, setTab] = useState<GateTab>('expected');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<{ row: IGateRow; action: GateAction } | null>(null);

  const matches = (row: IGateRow) => plateMatches(search, row.truck_plate, row.truck_plate_2);
  const expected = (board.data?.expected ?? []).filter(matches);
  const inside = (board.data?.inside ?? []).filter(matches);
  const recentlyLeft = (board.data?.recently_left ?? []).filter(matches);

  function handleConfirm() {
    if (!pending) return;
    const { row, action } = pending;
    gateAction.mutate(
      { id: row.id, action, locationId },
      {
        onSuccess: () => toast.success(t(`gate.done_${action.startsWith('undo') ? 'undo' : action}`)),
        onError: (error) => toast.error(
          t(`gate.error.${gateErrorCode(error) ?? 'generic'}`, { defaultValue: t('gate.error.generic') }),
        ),
        onSettled: () => setPending(null),
      },
    );
  }

  const onAction = (row: IGateRow, action: GateAction) => setPending({ row, action });

  if (board.isError) {
    const code = gateErrorCode(board.error);
    return (
      <Alert
        type={code === 'no_location' ? 'warning' : 'error'}
        showIcon
        style={{ margin: 16 }}
        message={code === 'no_location' ? t('gate.no_location') : t('gate.error.generic')}
      />
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 4px' }}>
      <Title level={4} style={{ marginBottom: 8 }}>
        {t('gate.title', { location: board.data?.location.name ?? '' })}
      </Title>
      {!isGuard && (
        <Select
          value={locationId ?? undefined}
          onChange={setPickedLocation}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
          placeholder={t('gate.location')}
          style={{ width: '100%', marginBottom: 8 }}
          size="large"
        />
      )}
      <Input.Search
        allowClear
        size="large"
        placeholder={t('gate.search_placeholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Segmented
        block
        size="large"
        value={tab}
        onChange={(value) => setTab(value as GateTab)}
        options={[
          { value: 'expected', label: t('gate.tab_expected', { count: expected.length }) },
          { value: 'inside', label: t('gate.tab_inside', { count: inside.length }) },
        ]}
        style={{ marginBottom: 12 }}
      />
      {board.isLoading ? (
        <Skeleton active />
      ) : tab === 'expected' ? (
        expected.length === 0 ? (
          <Empty description={t('gate.empty_expected')} />
        ) : (
          expected.map((row) => (
            <GateTruckCard key={row.id} row={row} primaryAction="arrive" onAction={onAction} />
          ))
        )
      ) : (
        <>
          {inside.length === 0 && <Empty description={t('gate.empty_inside')} />}
          {inside.map((row) => (
            <GateTruckCard
              key={row.id} row={row} primaryAction="depart" undoAction="undo_arrive" onAction={onAction}
            />
          ))}
          {recentlyLeft.length > 0 && (
            <>
              <Text type="secondary" style={{ display: 'block', margin: '16px 0 8px' }}>
                {t('gate.recently_left')}
              </Text>
              {recentlyLeft.map((row) => (
                <GateTruckCard key={row.id} row={row} undoAction="undo_depart" muted onAction={onAction} />
              ))}
            </>
          )}
        </>
      )}
      <GateConfirmModal
        pending={pending ? { plate: pending.row.truck_plate ?? pending.row.shipment_code, action: pending.action } : null}
        loading={gateAction.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
```

- [ ] **Step 9: Route, menu, landing**

`frontend/src/pages/IndexRoute.tsx`:

```tsx
import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));

/** `/` — the dashboard, except for a gate guard: the gate screen is his whole job. */
export default function IndexRoute() {
  const { user } = useAuth();
  if (user?.role === 'garawul') return <Navigate to="/export/gate" replace />;
  return <DashboardPage />;
}
```

`App.tsx`: replace the `DashboardPage` lazy import with `const IndexRoute = lazy(() => import('@/pages/IndexRoute'));` and `<Route index element={<DashboardPage />} />` with `<Route index element={<IndexRoute />} />`. Add `const GatePage = lazy(() => import('@/pages/export/GatePage'));` and, next to the task-rules route:

```tsx
                  <Route path="export/gate" element={
                    <ProtectedRoute pageCode="export.gate"><GatePage /></ProtectedRoute>
                  } />
```

`AppLayout.tsx` (another session has uncommitted edits here — add only these hunks): import `IconDoorEnter` from `@tabler/icons-react`; `ROUTE_LABELS`: `'/export/gate': t('gate.nav'),`; `ITEMS`: `'/export/gate': { key: '/export/gate', icon: <IconDoorEnter size={15} />, label: t('gate.nav') },`; add `'/export/gate'` to `BOSS_MENU_GROUPS` `nav.group_shipping` (after `'/export/gaplama'`) and to `STAFF_MENU_GROUPS` `nav.group_export` (first entry, so a guard's menu opens on it). Run `npx vitest run src/components/AppLayout.menuGroups.test.tsx`; if it snapshots group contents, add the key to its expectation.

- [ ] **Step 10: i18n `gate` block** (all three files, top level)

en:
```json
  "gate": {
    "nav": "Gate",
    "title": "Gate — {{location}}",
    "location": "Location",
    "tab_expected": "Expected ({{count}})",
    "tab_inside": "Inside ({{count}})",
    "search_placeholder": "Search plate",
    "arrive": "Arrived at greenhouse",
    "depart": "Left greenhouse",
    "undo": "Undo",
    "confirm_arrive": "Truck {{plate}} arrived at the greenhouse?",
    "confirm_depart": "Truck {{plate}} left the greenhouse?",
    "confirm_undo": "Undo the last mark for {{plate}}?",
    "yes": "Yes, confirm",
    "done_arrive": "Marked: arrived",
    "done_depart": "Marked: left",
    "done_undo": "Mark undone",
    "gapy": "Gapy",
    "overdue": "overdue",
    "recently_left": "Left in the last 10 minutes",
    "empty_expected": "No trucks expected",
    "empty_inside": "No trucks inside",
    "no_location": "No location assigned to you — contact the admin.",
    "error": {
      "not_expected": "This truck is no longer expected — the list has been refreshed.",
      "not_inside": "This truck is not inside — the list has been refreshed.",
      "not_here": "This truck is not at your location.",
      "undo_closed": "Too late to undo — ask the loading head to correct it on the Sheet.",
      "season_closed": "This truck's season is closed.",
      "no_location": "No location assigned to you — contact the admin.",
      "generic": "Could not save — try again."
    }
  },
```

tk:
```json
  "gate": {
    "nav": "Derweze",
    "title": "Derweze — {{location}}",
    "location": "Ýer",
    "tab_expected": "Gelmeli ({{count}})",
    "tab_inside": "Ýyladyşhanada ({{count}})",
    "search_placeholder": "Belgi boýunça gözle",
    "arrive": "Ýyladyşhana geldi",
    "depart": "Ýyladyşhanadan çykdy",
    "undo": "Yza al",
    "confirm_arrive": "{{plate}} ýyladyşhana geldimi?",
    "confirm_depart": "{{plate}} ýyladyşhanadan çykdymy?",
    "confirm_undo": "{{plate}} üçin soňky bellik yza alynsynmy?",
    "yes": "Hawa, tassykla",
    "done_arrive": "Bellendi: geldi",
    "done_depart": "Bellendi: çykdy",
    "done_undo": "Bellik yza alyndy",
    "gapy": "Gapy",
    "overdue": "gijä galdy",
    "recently_left": "Soňky 10 minutda çykanlar",
    "empty_expected": "Gelmeli maşyn ýok",
    "empty_inside": "Ýyladyşhanada maşyn ýok",
    "no_location": "Size ýer berilmedi — admin bilen habarlaşyň",
    "error": {
      "not_expected": "Bu maşyna indi garaşylmaýar — sanaw täzelendi.",
      "not_inside": "Bu maşyn ýyladyşhanada däl — sanaw täzelendi.",
      "not_here": "Bu maşyn siziň ýeriňizde däl.",
      "undo_closed": "Yza almak üçin giç — ýükleme müdirine Sheet-de düzetdiriň.",
      "season_closed": "Bu maşynyň möwsümi ýapyk.",
      "no_location": "Size ýer berilmedi — admin bilen habarlaşyň",
      "generic": "Ýazdyrylmady — gaýtadan synanyşyň."
    }
  },
```

ru:
```json
  "gate": {
    "nav": "КПП",
    "title": "КПП — {{location}}",
    "location": "Площадка",
    "tab_expected": "Ожидаются ({{count}})",
    "tab_inside": "На территории ({{count}})",
    "search_placeholder": "Поиск по номеру",
    "arrive": "Прибыл в теплицу",
    "depart": "Выехал из теплицы",
    "undo": "Отменить",
    "confirm_arrive": "Машина {{plate}} прибыла в теплицу?",
    "confirm_depart": "Машина {{plate}} выехала из теплицы?",
    "confirm_undo": "Отменить последнюю отметку для {{plate}}?",
    "yes": "Да, подтвердить",
    "done_arrive": "Отмечено: прибыл",
    "done_depart": "Отмечено: выехал",
    "done_undo": "Отметка отменена",
    "gapy": "Гапы",
    "overdue": "просрочено",
    "recently_left": "Выехали за последние 10 минут",
    "empty_expected": "Ожидаемых машин нет",
    "empty_inside": "На территории машин нет",
    "no_location": "Вам не назначена площадка — обратитесь к администратору.",
    "error": {
      "not_expected": "Эта машина больше не ожидается — список обновлён.",
      "not_inside": "Этой машины нет на территории — список обновлён.",
      "not_here": "Эта машина не на вашей площадке.",
      "undo_closed": "Отменить уже нельзя — попросите начальника погрузки исправить в Sheet.",
      "season_closed": "Сезон этой машины закрыт.",
      "no_location": "Вам не назначена площадка — обратитесь к администратору.",
      "generic": "Не сохранилось — попробуйте ещё раз."
    }
  },
```

- [ ] **Step 11: Run tests + typecheck**

Run: `npx vitest run src/utils/plateSearch.test.ts src/pages/export/GatePage.test.tsx src/components/AppLayout.menuGroups.test.tsx && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, 0 type errors.

- [ ] **Step 12: Commit** (with approval; `AppLayout.tsx`, `App.tsx` and i18n via `git add -p`)

```bash
git add frontend/src/utils/plateSearch.ts frontend/src/utils/plateSearch.test.ts frontend/src/hooks/useGate.ts frontend/src/components/gate frontend/src/pages/export/GatePage.tsx frontend/src/pages/export/GatePage.test.tsx frontend/src/pages/IndexRoute.tsx
git add -p frontend/src/App.tsx frontend/src/components/AppLayout.tsx frontend/src/components/AppLayout.menuGroups.test.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): gate screen for the garawul — expected and inside trucks"
```

---

### Task 10: Gate task card on My Tasks

**Files:**
- Create: `frontend/src/components/me/GateTaskCard.tsx`, `frontend/src/components/me/GateTaskCard.test.tsx`
- Modify: `frontend/src/pages/me/SelfBoard.tsx`

**Interfaces:**
- Consumes: `useGateAction`, `gateErrorCode`, `GateAction`, `GateConfirmModal` (Task 9); `ITaskListItem.truck_plate/scope_location` (Task 8).
- Produces: `<GateTaskCard task={ITaskListItem} />`.

- [ ] **Step 1: Failing tests** — `frontend/src/components/me/GateTaskCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18n from '@/i18n';
import { GateTaskCard } from './GateTaskCard';
import { useGateAction } from '@/hooks/useGate';
import { useAuth } from '@/hooks/useAuth';
import type { ITaskListItem } from '@/types';

vi.mock('@/hooks/useGate', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useGate')>()),
  useGateAction: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));

const mutate = vi.fn();

function task(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
  return {
    id: 10, shipment: 7, shipment_code: '0000007/26', kind: 'gate', link: '/export/gate',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: 3, truck_plate: '1535AKM', step: 'gate_arrive', phase: 'DOCS',
    title_key: 'tasks.gate_arrive', assignee_role: 'garawul', assignee_user: null,
    assignee_user_name: null, target_fields_list: [], completion_rule: 'manual_done',
    deadline: null, deadline_rule: '', state: 'open', is_overdue: false,
    created_at: '2026-09-29T08:00:00Z', started_at: null, completed_at: null, blocked_reason: '',
    ...overrides,
  } as ITaskListItem;
}

const GATE_EDIT = { gate: { view: true, create: true, edit: true, delete: true } };

function setup(t: ITaskListItem, role = 'garawul', resource_permissions: object = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { role, is_superuser: false, resource_permissions },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
  return render(<GateTaskCard task={t} />);
}

describe('GateTaskCard', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the plate and marks arrival after a confirm', () => {
    setup(task());
    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived at greenhouse' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith({ id: 7, action: 'arrive', locationId: null }, expect.any(Object));
  });

  it('an exit task marks departure; a supervisor sends the task location', () => {
    setup(task({ step: 'gate_depart', title_key: 'tasks.gate_depart' }), 'admin', GATE_EDIT);
    fireEvent.click(screen.getByRole('button', { name: 'Left greenhouse' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith({ id: 7, action: 'depart', locationId: 3 }, expect.any(Object));
  });

  it('a done task has no button', () => {
    setup(task({ state: 'done' }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a supervisor without the gate grant sees the card but no button', () => {
    // export_manager / director see every role's tasks on My Tasks but hold no
    // `gate` resource (Task 2) — the button would only 403.
    setup(task(), 'export_manager');
    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/me/GateTaskCard.test.tsx` → FAIL (module missing).

- [ ] **Step 2: The card** — `frontend/src/components/me/GateTaskCard.tsx`:

```tsx
import { useState } from 'react';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { gateErrorCode, useGateAction } from '@/hooks/useGate';
import type { GateAction } from '@/hooks/useGate';
import { GateConfirmModal } from '@/components/gate/GateConfirmModal';
import type { ITaskListItem } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IGateTaskCardProps {
  readonly task: ITaskListItem;
}

/**
 * A gate task (kind='gate') on My Tasks. Its button does exactly what the gate
 * screen's does — same endpoint — so the task closes the same way. No generic
 * "Done": a gate task must never close without the mark.
 */
export function GateTaskCard({ task }: IGateTaskCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const gateAction = useGateAction();
  const [confirming, setConfirming] = useState(false);
  const action: GateAction = task.step === 'gate_depart' ? 'depart' : 'arrive';
  const plate = task.truck_plate ?? task.shipment_code;
  const isOpen = task.state === 'open' || task.state === 'in_progress';
  const isGuard = user?.role === 'garawul';
  // Supervisors see every role's tasks but may lack the `gate` grant — no button
  // that can only 403.
  const canMark = isGuard || Boolean(user?.is_superuser) || Boolean(user?.resource_permissions?.gate?.edit);
  const locationId = isGuard ? null : task.scope_location;

  function handleConfirm() {
    if (task.shipment == null) return;
    gateAction.mutate(
      { id: task.shipment, action, locationId },
      {
        onSuccess: () => toast.success(t(`gate.done_${action}`)),
        onError: (error) => toast.error(
          t(`gate.error.${gateErrorCode(error) ?? 'generic'}`, { defaultValue: t('gate.error.generic') }),
        ),
        onSettled: () => setConfirming(false),
      },
    );
  }

  return (
    <div
      style={{
        background: COLORS.white,
        border: '1px solid #f0f0f0',
        borderLeft: `3px solid ${isOpen ? COLORS.primary : COLORS.borderLight}`,
        borderRadius: 6,
        padding: '8px 10px',
        opacity: isOpen ? 1 : 0.6,
      }}
    >
      <Text strong>{t(task.title_key, { plate })}</Text>
      {isOpen && canMark && (
        <Button type="primary" size="large" block onClick={() => setConfirming(true)} style={{ marginTop: 8 }}>
          {t(`gate.${action}`)}
        </Button>
      )}
      <GateConfirmModal
        pending={confirming ? { plate, action } : null}
        loading={gateAction.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Use it on the board** — `SelfBoard.tsx`: import `GateTaskCard` from `@/components/me/GateTaskCard`; in **both** card renders (column and History), put a gate branch first:

```tsx
                {colTasks.map((task) =>
                  task.kind === 'gate' ? (
                    <GateTaskCard key={task.id} task={task} />
                  ) : isPlanTask(task) ? (
                    <PlanTaskCard key={task.id} task={task} />
                  ) : (
                    <SelfKanbanCard
                      key={task.id}
                      task={task}
                      onCardClick={setDrawerTask}
                      onMove={requestMove}
                    />
                  ),
                )}
```

(History: the same with `historyTasks` and without `onMove`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/me src/pages/me && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit** (with approval)

```bash
git add frontend/src/components/me/GateTaskCard.tsx frontend/src/components/me/GateTaskCard.test.tsx frontend/src/pages/me/SelfBoard.tsx
git commit -m "feat(frontend): gate task card marks arrival and exit from My Tasks"
```

---

### Task 11: Docs, changelog, build log

**Files:**
- Create: `docs/obsidian/roles/garawul.md`, `docs/obsidian/processes/gate.md`
- Modify: `docs/obsidian/00-index.md`, `docs/obsidian/processes/permissions-system.md` (shared-dirty — hunks only), `docs/obsidian/screens/shipment-sheet.md`, `.claude/skills/api-contract/SKILL.md`, `CHANGELOG.md`, `BUILD_TEST_LOG.md`

- [ ] **Step 1: Role note** `docs/obsidian/roles/garawul.md` — follow the shape of `roles/boss.md`: who (one guard per gate: Dusak / Kaka / Owadandepe), what he sees (`/export/gate` + My Tasks only; no Sheet, no shipment list), what he does (Geldi / Çykdy / Yza al), how he is bound (`User.loading_location`, set on `/admin/users`), permissions (`export.gate`, `me.board`, resource `gate` view+edit), and links `[[gate]]`, `[[permissions-system]]`.

- [ ] **Step 2: Process note** `docs/obsidian/processes/gate.md` — the lists (exact filters from `services/gate.py`), the three actions and what each writes, the status effects (`gumruk_chykysh → yuklenme` on arrival via R19; `yuklenme → yola_chykdy / tamamlandy` on exit via R21), undo rule (10 min, no status move, reopens the trigger task it closed), gate tasks (`kind='gate'`, `scope_location`, lazy `sync_gate_tasks`), notification `gate_arrival` to head + deputies, the endpoint table, the Sheet row 49, and known limits (truck invisible until plate + blocks; unjoined supply/export rows; packaging moved after arrival stays pinned by `loading_location`).

- [ ] **Step 3: Index + cross-links** — add both notes to `00-index.md`; in `permissions-system.md` add the `export.gate` page, the `gate` resource and the carve-out from the director/export_manager/document_team wildcards; in `screens/shipment-sheet.md` add row 49 «Ýyladyşhana geldi» to the timestamp list and bump the row count.

- [ ] **Step 4: API contract** — in `.claude/skills/api-contract/SKILL.md` add a `### Gate: /api/v1/export/gate/` section with the four calls, the row shape (`IGateRow` fields) and the error codes.

- [ ] **Step 5: CHANGELOG** — under `[Unreleased]` → **Added**: `feat(p3): garawul gate guard — gate screen, arrival/exit marks, gate tasks, Sheet row «Ýyladyşhana geldi»`.

- [ ] **Step 6: Build log** — top of `BUILD_TEST_LOG.md`: `- [ ] 2026-09-29 — Garawul gate guard: /export/gate screen, arrive/depart/undo, gate tasks on My Tasks, Sheet row 49 — NEEDS TEST`. Tell the user: *"Built — NOT tested yet. Did you test it?"*

- [ ] **Step 7: Commit** (with approval; `permissions-system.md` via `git add -p`)

```bash
git add docs/obsidian/roles/garawul.md docs/obsidian/processes/gate.md docs/obsidian/00-index.md docs/obsidian/screens/shipment-sheet.md .claude/skills/api-contract/SKILL.md CHANGELOG.md BUILD_TEST_LOG.md
git add -p docs/obsidian/processes/permissions-system.md
git commit -m "docs: garawul gate guard — role, process, API contract"
```

---

## Final verification (before claiming done)

```bash
cd backend
./venv/Scripts/python.exe manage.py makemigrations --check --dry-run
./venv/Scripts/python.exe manage.py test apps.core apps.export --noinput --verbosity=1
cd ../frontend
npx tsc --noEmit --ignoreDeprecations 5.0
npx vitest run
```

Report exact counts. The backend suite has pre-existing failures (memory "Backend Test Suite Failures": 4 buckets) — compare against a run on the base commit before calling any failure new.
