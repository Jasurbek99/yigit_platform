# Agent Market — Part A (foundation: roles, fence, app, logins, team) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents (`core.Customer`) and their sellers can log in as two new external roles, are fenced off every
non-market API, and an agent manages its own bazaars and seller logins; our staff create agent logins.

**Architecture:** Two new roles in `core` plus an API fence in the cookie-JWT authentication class. A new Django
app `market` (after `export` in the dependency chain) holds `Bazaar` and `AgentMember` and a single scoping
module every market view uses. Frontend: role plumbing and a desktop «Логины агентов» page in the main app; a
**separate light app** at `/m/` (second Vite entry `m.html` + `src/market-app/`, no Ant Design, artifact design,
responsive phone / tablet / desktop) with its own login, shell and the agent's team screen; installable as a
PWA (manifest + no-cache service worker). Parts B–E (lots, sales, debts, panels,
SalesReport) get their own plans after this one is merged into the branch.

**Tech Stack:** Django 5.1 + DRF + simplejwt (cookie), MSSQL (mssql-django), React 18 + TS + Ant Design +
TanStack Query + react-i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md` (§1 dependency position, §2 Bazaar /
AgentMember, §3 roles/permissions/scoping, §9 phone shell, §10 rollout).

## Global Constraints

- Work only in the worktree `D:/projects/yigit_platform-market`, branch `feat/agent-market`. Never touch `D:/projects/yigit_platform` (shared tree of other sessions).
- **Commits:** the user's CLAUDE.md forbids committing without the word "commit". Run the commit step of a task only if the user has authorized commits for this plan run; otherwise stop after the test step and report.
- **Never apply migrations to the shared DB** (`migrate` against `YIGIT_PLATFROM`) on this branch. Tests only, on a private test DB.
- Test command (always): `cd D:/projects/yigit_platform-market/backend && TEST_DB_NAME=test_YIGIT_MARKET DJANGO_TESTING=true /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py test <labels> --noinput -v 1`
- MSSQL rules: no JSONField/ArrayField/DISTINCT ON; `bulk_create(..., batch_size=500)`; CharField always `max_length`; Cyrillic text `**cyrillic_collation()` from `apps.core.db_utils`; reference FKs `on_delete=models.PROTECT`; tables via `schema_table('market', '<name>')`.
- Dependency direction `core ← greenhouse ← export ← market ← contracts ← finance`: `core` and `export` must never import `market`. No Django signals.
- `models/` is a package with re-exports in `__init__.py`.
- Role codes exactly `agent` (label «Agent») and `agent_seller` (label «Agent Seller»). Page codes exactly `market.home`, `market.team`, `market.agents`. Resource codes exactly `market_agent`, `market_team`.
- External roles may call only `/api/v1/auth/` and `/api/v1/market/`; everything else 403.
- UI copy for agents is Russian; every key exists in `src/i18n/ru.json`, `tk.json`, `en.json`. Never the word "draft"/«черновик» in UI.
- The market app (`src/market-app/`) must not import `antd`, `@ant-design/*`, `src/components/AppLayout*` or any main-app page. It may import `@/services/api`, `@/i18n`, `@/types`, `@/constants/roles`, `@/utils/loginRedirect`.
- Market app design and layout = the artifact (spec §9): tokens, Sofia Sans, targets ≥ 48 px (main actions 64–76 px), light + dark, 1 / 2 / 3 columns at 0 / 760 / 1100 px, container ≤ 1200 px, 16 px gutter, no horizontal scroll at 320 px.
- Business rules live on the server only; the phone may preview numbers but never decides (React Native later reuses the API).
- Frontend type check: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken). Tests: `npx vitest run <path>`.
- Before writing any migration: `ls backend/apps/<app>/migrations | tail -3` in the worktree; numbers below assume core ends at `0074`, export at `0098`, market new — adjust and fix the `dependencies` if not.

## Review Focus

1. A logged-in `agent_seller` calling any export endpoint with the real cookie (not `force_authenticate`) gets 403 — tests that use `force_authenticate` skip authentication classes, so the fence test must use a real cookie (Task 2).
2. An `agent` of customer A sending ids of customer B's bazaar / seller gets 404, never data or an edit (Task 6).
3. A `sales_rep` creating an agent login for a customer that is not theirs gets 403 (Task 5).
4. A new permission Save on `/admin/permissions` must not drop market rows: every role has a row for every new page code, boss has resource + `'*'` field rows for the new resources (Task 3).
5. A deactivated seller (`is_active=False`) cannot log in and disappears from the agent's active list but stays in the DB (Task 6).

---

### Task 0: Worktree setup (no code, no commit)

- [ ] **Step 1:** `cp /d/projects/yigit_platform/backend/.env /d/projects/yigit_platform-market/backend/.env`
- [ ] **Step 2:** `cd /d/projects/yigit_platform-market/frontend && npm ci` (node_modules is not shared between worktrees).
- [ ] **Step 3:** Baseline: run the test command with labels `apps.core.tests_garawul apps.core.tests_boss_access` — expect PASS. If it fails, stop and report (pre-existing, not ours).

---

### Task 1: Two new roles in `core` and `export`

**Files:**
- Modify: `backend/apps/core/models/user.py` (ROLE_CHOICES, add `EXTERNAL_ROLES`)
- Create: `backend/apps/core/migrations/0075_agent_roles.py`
- Create: `backend/apps/export/migrations/0099_agent_role_choices.py`
- Test: `backend/apps/core/tests_agent_roles.py`

**Interfaces:**
- Produces: `apps.core.models.user.EXTERNAL_ROLES: frozenset[str] = frozenset({'agent', 'agent_seller'})` — used by Task 2 (fence) and Task 4 (scoping).

- [ ] **Step 1: Write the failing test** — `backend/apps/core/tests_agent_roles.py`

```python
from django.test import TestCase

from apps.core.models.user import EXTERNAL_ROLES, ROLE_CHOICES


class AgentRoleChoicesTests(TestCase):

    def test_both_roles_are_choices(self):
        codes = {code for code, _ in ROLE_CHOICES}
        self.assertIn('agent', codes)
        self.assertIn('agent_seller', codes)

    def test_external_roles_are_exactly_the_agent_roles(self):
        self.assertEqual(EXTERNAL_ROLES, frozenset({'agent', 'agent_seller'}))

    def test_existing_seller_role_untouched(self):
        self.assertIn(('seller', 'Seller'), ROLE_CHOICES)
```

- [ ] **Step 2: Run it** — labels `apps.core.tests_agent_roles`. Expected: ImportError on `EXTERNAL_ROLES`.

- [ ] **Step 3: Implement** — in `user.py`, insert before `('boss', 'Boss'),`:

```python
    # agent: our agent at a destination market (core.Customer), bound to it by
    # market.AgentMember. Manages its bazaars and seller logins, does not sell.
    # External user on public networks — fenced to /api/v1/market/ (see
    # CookieJWTAuthentication). Spec 2026-10-08-agent-market-sales-design.md.
    ('agent', 'Agent'),
    # agent_seller: the agent's seller at one bazaar; records sales on a phone.
    ('agent_seller', 'Agent Seller'),
```

and after the `ROLE_CHOICES` list:

```python
# Roles of people outside YGT (agents at the destination market and their sellers).
# They may call only the auth and market APIs — enforced in CookieJWTAuthentication.
EXTERNAL_ROLES: frozenset[str] = frozenset({'agent', 'agent_seller'})
```

- [ ] **Step 4: Generate the choices migrations** — from `backend/`:
  `/d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py makemigrations core export --name agent_roles`
  Rename the export one to `0099_agent_role_choices.py` (and core to `0075_agent_roles.py` if numbered differently). Open both: core must contain exactly 4 `AlterField` (`rolefieldpermission.role`, `rolepagepermission.role`, `roleresourcepermission.role`, `user.role`), export exactly 2 (`sheetrowroletrigger.role`, `sheetrowsetting.role_group`), each list ending `..., ("garawul", "Gate Guard"), ("agent", "Agent"), ("agent_seller", "Agent Seller"), ("boss", "Boss")`. Delete anything else the command produced and report it.
  Do **not** run `migrate`.

- [ ] **Step 5: Run tests** — labels `apps.core.tests_agent_roles`; then `manage.py makemigrations --check --dry-run` → "No changes detected".

- [ ] **Step 6: Commit** (only if authorized)

```bash
git add backend/apps/core/models/user.py backend/apps/core/migrations/0075_agent_roles.py backend/apps/export/migrations/0099_agent_role_choices.py backend/apps/core/tests_agent_roles.py
git commit -m "feat(core): agent and agent_seller roles"
```

---

### Task 2: API fence for external roles

**Files:**
- Modify: `backend/apps/core/authentication.py`
- Test: `backend/apps/core/tests_external_role_fence.py`

**Interfaces:**
- Consumes: `EXTERNAL_ROLES` (Task 1).
- Produces: `apps.core.authentication.EXTERNAL_ALLOWED_PREFIXES = ('/api/v1/auth/', '/api/v1/market/')`.

- [ ] **Step 1: Write the failing test**

```python
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.models import User


def _cookie_client(user) -> APIClient:
    """Real cookie auth — force_authenticate would skip the authentication class."""
    client = APIClient()
    client.cookies[settings.SIMPLE_JWT['AUTH_COOKIE']] = str(RefreshToken.for_user(user).access_token)
    return client


class ExternalRoleFenceTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.seller = User.objects.create_user(username='fence_s', password='pw', role='agent_seller')
        cls.agent = User.objects.create_user(username='fence_a', password='pw', role='agent')
        cls.admin = User.objects.create_user(username='fence_adm', password='pw', role='admin')

    def test_external_roles_blocked_outside_market(self):
        for user in (self.seller, self.agent):
            for url in ('/api/v1/export/shipments/', '/api/v1/core/countries/', '/api/v1/me/tasks/'):
                with self.subTest(user=user.role, url=url):
                    self.assertEqual(_cookie_client(user).get(url).status_code, 403)

    def test_external_roles_reach_auth_me(self):
        resp = _cookie_client(self.seller).get('/api/v1/auth/me/')
        self.assertEqual(resp.status_code, 200)

    def test_internal_roles_not_fenced(self):
        self.assertNotEqual(_cookie_client(self.admin).get('/api/v1/core/countries/').status_code, 403)
```

- [ ] **Step 2: Run** — labels `apps.core.tests_external_role_fence`. Expected: `test_external_roles_blocked_outside_market` FAILS (200/other).

- [ ] **Step 3: Implement** — `authentication.py`:

```python
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.conf import settings

from apps.core.models.user import EXTERNAL_ROLES

# External users (agents and their sellers) may reach only these API trees.
# Checked here because every DRF view authenticates through this class; a view
# that forgot its permission_classes still cannot leak internal data to them.
EXTERNAL_ALLOWED_PREFIXES = ('/api/v1/auth/', '/api/v1/market/')
```

and in `authenticate`, after `user = self.get_user(validated_token)`:

```python
        if getattr(user, 'role', None) in EXTERNAL_ROLES and not request.path.startswith(EXTERNAL_ALLOWED_PREFIXES):
            raise PermissionDenied('Not available for this role.')
```

- [ ] **Step 4: Run** — labels `apps.core.tests_external_role_fence apps.core.tests_garawul`. Expected: PASS.

- [ ] **Step 5: Commit** (only if authorized)

```bash
git add backend/apps/core/authentication.py backend/apps/core/tests_external_role_fence.py
git commit -m "feat(core): fence external agent roles to auth and market APIs"
```

---

### Task 3: Permission registry, seed defaults, data migration

**Files:**
- Modify: `backend/apps/core/permission_registry.py` (PAGE_REGISTRY, RESOURCE_REGISTRY)
- Modify: `backend/apps/core/management/commands/seed_permissions.py`
- Create: `backend/apps/core/migrations/0076_seed_agent_market_perms.py`
- Modify: `frontend/src/utils/permissions.ts` (ROUTE_PAGE_MAP)
- Test: `backend/apps/core/tests_agent_perms.py`

**Interfaces:**
- Produces: pages `market.home` (phone shell), `market.team` (agent team screen), `market.agents` (desktop agent logins); resources `market_agent`, `market_team`.

Grants (from spec §3):

| Role | Visible market pages | `market_agent` | `market_team` |
|---|---|---|---|
| agent | market.home, market.team | — | VCRUD |
| agent_seller | market.home | — | — |
| admin | (all, as today) | VCRUD | VCRUD |
| boss | market.agents | VCRUD (convention: boss holds all) | VCRUD |
| director, export_manager, document_team | market.agents | VIEW | VIEW |
| sales_rep | market.agents | VCE | — |

- [ ] **Step 1: Write the failing test** — `backend/apps/core/tests_agent_perms.py`

```python
import importlib
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from apps.core.models.role_permissions import (
    RoleFieldPermission, RolePagePermission, RoleResourcePermission,
)
from apps.core.models.user import ROLE_CHOICES
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY

MARKET_PAGES = {'market.home', 'market.team', 'market.agents'}


def _perm_migration():
    path = next(Path(__file__).parent.joinpath('migrations').glob('*_seed_agent_market_perms.py'))
    return importlib.import_module(f'apps.core.migrations.{path.stem}')


def _visible(role):
    return set(RolePagePermission.objects.filter(role=role, is_visible=True).values_list('page_code', flat=True))


def _flags(role, resource):
    row = RoleResourcePermission.objects.get(role=role, resource_code=resource)
    return (row.can_view, row.can_create, row.can_edit, row.can_delete)


class AgentPermissionSeedTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)

    def test_registry_has_market_codes(self):
        self.assertTrue(MARKET_PAGES <= set(PAGE_REGISTRY))
        self.assertTrue({'market_agent', 'market_team'} <= set(RESOURCE_REGISTRY))

    def test_agent_sees_only_market_phone_pages(self):
        self.assertEqual(_visible('agent'), {'market.home', 'market.team'})
        self.assertEqual(_visible('agent_seller'), {'market.home'})

    def test_every_role_has_a_row_for_every_page(self):
        for code, _ in ROLE_CHOICES:
            with self.subTest(role=code):
                self.assertEqual(RolePagePermission.objects.filter(role=code).count(), len(PAGE_REGISTRY))

    def test_internal_roles_do_not_see_phone_pages(self):
        for role in ('director', 'export_manager', 'document_team', 'sales_rep', 'boss'):
            with self.subTest(role=role):
                self.assertFalse(_visible(role) & {'market.home', 'market.team'})
                self.assertIn('market.agents', _visible(role))

    def test_resource_grants(self):
        self.assertEqual(_flags('agent', 'market_team'), (True, True, True, True))
        self.assertEqual(_flags('sales_rep', 'market_agent'), (True, True, True, False))
        for role in ('director', 'export_manager', 'document_team'):
            with self.subTest(role=role):
                self.assertEqual(_flags(role, 'market_agent'), (True, False, False, False))
                self.assertEqual(_flags(role, 'market_team'), (True, False, False, False))

    def test_boss_has_field_rows_for_market_resources(self):
        for res in ('market_agent', 'market_team'):
            self.assertTrue(RoleFieldPermission.objects.filter(role='boss', resource_code=res, field_name='*').exists())

    def test_migration_snapshot_covers_every_registered_page(self):
        self.assertEqual(set(_perm_migration().ALL_PAGES), set(PAGE_REGISTRY))

    def test_migration_visible_sets_match_seed(self):
        from apps.core.management.commands.seed_permissions import PAGE_DEFAULTS
        mig = _perm_migration()
        self.assertEqual(set(mig.AGENT_VISIBLE), PAGE_DEFAULTS['agent'])
        self.assertEqual(set(mig.SELLER_VISIBLE), PAGE_DEFAULTS['agent_seller'])
```

- [ ] **Step 2: Run** — labels `apps.core.tests_agent_perms`. Expected: FAIL (codes missing).

- [ ] **Step 3: Registry** — `permission_registry.py`: before `('admin.users', ...)` add

```python
    # Agent market (bazaar sales) — spec 2026-10-08-agent-market-sales-design.md.
    # market.home / market.team: the phone shell of agents and their sellers.
    # market.agents: our staff's desktop page to create agent logins.
    ('market.home',             'Market: phone home (agent / seller)'),
    ('market.team',             'Market: agent team (bazaars, seller logins)'),
    ('market.agents',           'Market: agent logins'),
```

and at the end of `RESOURCE_REGISTRY`:

```python
    # Agent market. All-or-nothing, absent from RESOURCE_FIELDS.
    ('market_agent',          'Market: agent logins'),
    ('market_team',           'Market: agent bazaars and seller logins'),
```

- [ ] **Step 4: Seed defaults** — `seed_permissions.py`:
  1. Next to `_GATE_PAGES` add
     ```python
     _MARKET_PHONE_PAGES = {'market.home', 'market.team'}
     _MARKET_RESOURCES = {'market_agent', 'market_team'}
     _EXTERNAL = ('agent', 'agent_seller')
     ```
  2. Subtract `_MARKET_PHONE_PAGES` wherever `_GATE_PAGES` is subtracted (`director`, `export_manager`); `document_team` inherits from export_manager.
  3. In `PAGE_DEFAULTS` add
     ```python
     'agent': {'market.home', 'market.team'},
     'agent_seller': {'market.home'},
     ```
     add `'market.agents'` to `sales_rep`'s set, and change boss (line ~182)
     `'boss': _ALL_PAGES - _BOSS_DEAD_PAGES,` → `'boss': _ALL_PAGES - _BOSS_DEAD_PAGES - _MARKET_PHONE_PAGES,`
     (boss keeps `market.agents` because it is in `_ALL_PAGES`).
  4. Exclude external roles from the every-role loops: `if _role not in ('seller', 'garawul'):` → `if _role not in ('seller', 'garawul', *_EXTERNAL):`, and in the `_TIR_TAKIP` loop `if _role == 'garawul':` → `if _role in ('garawul', *_EXTERNAL):`. Search the file for any other `for _role in PAGE_DEFAULTS` loop and exclude `_EXTERNAL` there too.
  5. `RESOURCE_DEFAULTS`: director / export_manager `**{r: _VCRUD for r in _ALL_RESOURCES - _GATE_RESOURCES - _MARKET_RESOURCES}`, then `**{r: _VIEW for r in _MARKET_RESOURCES}` in the same dicts. Add
     ```python
     'agent': {'market_team': _VCRUD},
     'agent_seller': {},
     ```
     and `'market_agent': _VCE` in `sales_rep`. Admin and boss stay `_ALL_RESOURCES` (they get VCRUD automatically). `FIELD_DEFAULTS['boss']` already covers every resource.

- [ ] **Step 5: Data migration** — `0076_seed_agent_market_perms.py`. Copy the structure of `0067_seed_garawul_perms.py` (test-DB guard by name prefix, `_grant`, `_wipe_perm_cache`, reversible). Content specifics:

```python
"""Seed the permission matrix for the agent market (agent, agent_seller, market.* pages).

seed_permissions only runs on a fresh DB; production runs `migrate`. Every role
gets a row for every new page code, and the two new roles get a row for every
page code — /admin/permissions Save deletes and recreates page rows, so a partial
matrix silently loses access (core/0054, the tir_takip incident 2026-09-16).
Snapshots are frozen so the migration replays identically.
"""
from django.db import migrations

NEW_PAGES = ['market.home', 'market.team', 'market.agents']
# Snapshot of PAGE_REGISTRY keys after Task 3 Step 3 — generate it, do not hand-type:
#   python -c "import django,os;os.environ['DJANGO_SETTINGS_MODULE']='config.settings';django.setup();from apps.core.permission_registry import PAGE_REGISTRY;print(list(PAGE_REGISTRY))"
ALL_PAGES = [...]  # paste the printed list
# Every role code after Task 1 (snapshot of ROLE_CHOICES codes).
ALL_ROLES = [...]  # paste [c for c, _ in ROLE_CHOICES]
AGENT_VISIBLE = {'market.home', 'market.team'}
SELLER_VISIBLE = {'market.home'}
AGENTS_PAGE_ROLES = {'admin', 'boss', 'director', 'export_manager', 'document_team', 'sales_rep'}

VCRUD = (True, True, True, True)
VIEW = (True, False, False, False)
VCE = (True, True, True, False)
RESOURCE_GRANTS = {
    ('agent', 'market_team'): VCRUD,
    ('admin', 'market_agent'): VCRUD, ('admin', 'market_team'): VCRUD,
    ('boss', 'market_agent'): VCRUD, ('boss', 'market_team'): VCRUD,
    ('sales_rep', 'market_agent'): VCE,
    **{(r, res): VIEW for r in ('director', 'export_manager', 'document_team')
       for res in ('market_agent', 'market_team')},
}


def seed(apps, schema_editor):
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    Page = apps.get_model('core', 'RolePagePermission')
    Res = apps.get_model('core', 'RoleResourcePermission')
    Field = apps.get_model('core', 'RoleFieldPermission')
    for page in ALL_PAGES:
        Page.objects.get_or_create(role='agent', page_code=page, defaults={'is_visible': page in AGENT_VISIBLE})
        Page.objects.get_or_create(role='agent_seller', page_code=page, defaults={'is_visible': page in SELLER_VISIBLE})
    for role in ALL_ROLES:
        if role in ('agent', 'agent_seller'):
            continue
        for page in NEW_PAGES:
            visible = page == 'market.agents' and role in AGENTS_PAGE_ROLES
            Page.objects.get_or_create(role=role, page_code=page, defaults={'is_visible': visible})
    for (role, res), flags in RESOURCE_GRANTS.items():
        _grant(Res, role, res, flags)
    for res in ('market_agent', 'market_team'):
        Field.objects.get_or_create(role='boss', resource_code=res, field_name='*')
    _wipe_perm_cache()


def unseed(apps, schema_editor):
    Page = apps.get_model('core', 'RolePagePermission')
    Res = apps.get_model('core', 'RoleResourcePermission')
    Field = apps.get_model('core', 'RoleFieldPermission')
    Page.objects.filter(role__in=('agent', 'agent_seller')).delete()
    Page.objects.filter(page_code__in=NEW_PAGES).delete()
    Res.objects.filter(resource_code__in=('market_agent', 'market_team')).delete()
    Field.objects.filter(resource_code__in=('market_agent', 'market_team')).delete()
    _wipe_perm_cache()

# _grant and _wipe_perm_cache: copy verbatim from 0067.

class Migration(migrations.Migration):
    dependencies = [("core", "0075_agent_roles")]
    operations = [migrations.RunPython(seed, reverse_code=unseed)]
```

  Replace both `[...]` with the generated lists before running the tests (the snapshot test fails otherwise — that is its job).

- [ ] **Step 6: Frontend route map** — `frontend/src/utils/permissions.ts` `ROUTE_PAGE_MAP`: add `'/market/agents': 'market.agents',` (the `/m/` routes live in the separate market app, Task 9).

- [ ] **Step 7: Run** — labels `apps.core.tests_agent_perms apps.core.tests_boss_access apps.core.tests_garawul`. Expected: PASS. If `tests_garawul.test_guard_has_a_row_for_every_page` or similar now fails because counts changed, it is because seed covers new pages — verify and report; do not weaken the test.

- [ ] **Step 8: Commit** (only if authorized)

```bash
git add backend/apps/core/permission_registry.py backend/apps/core/management/commands/seed_permissions.py backend/apps/core/migrations/0076_seed_agent_market_perms.py backend/apps/core/tests_agent_perms.py frontend/src/utils/permissions.ts
git commit -m "feat(core): market pages and resources in the permission matrix"
```

---

### Task 4: `market` app, `Bazaar`, `AgentMember`, scoping

**Files:**
- Create: `backend/apps/market/__init__.py`, `apps.py`, `urls.py`, `models/__init__.py`, `models/team.py`, `scoping.py`, `migrations/__init__.py`, `migrations/0001_initial.py` (generated), `tests/__init__.py`, `tests/test_scoping.py`
- Modify: `backend/config/settings.py:114-119` (INSTALLED_APPS), `backend/config/urls.py` (include)

**Interfaces:**
- Produces (`apps.market.models`): `Bazaar(customer, name, city, is_active)`, `AgentMember(user, customer, bazaar)`.
- Produces (`apps.market.scoping`):
  - `member_of(user) -> AgentMember | None`
  - `customer_ids_for(user) -> list[int] | None` — `None` means "all customers" (staff with full view); `[]` means nothing.
  - `STAFF_ALL = frozenset({'admin', 'boss', 'director', 'export_manager', 'document_team'})`

- [ ] **Step 1: Write the failing test** — `backend/apps/market/tests/test_scoping.py`

```python
from django.test import TestCase

from apps.core.models import Customer, User
from apps.market.models import AgentMember, Bazaar
from apps.market.scoping import customer_ids_for, member_of


class ScopingTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.rep = User.objects.create_user(username='sc_rep', password='pw', role='sales_rep')
        cls.cust_a = Customer.objects.create(name='Агент А', sales_rep=cls.rep)
        cls.cust_b = Customer.objects.create(name='Агент Б')
        cls.agent = User.objects.create_user(username='sc_ag', password='pw', role='agent')
        AgentMember.objects.create(user=cls.agent, customer=cls.cust_a)
        cls.bazaar = Bazaar.objects.create(customer=cls.cust_a, name='Алтын Орда')
        cls.seller = User.objects.create_user(username='sc_se', password='pw', role='agent_seller')
        AgentMember.objects.create(user=cls.seller, customer=cls.cust_a, bazaar=cls.bazaar)
        cls.orphan = User.objects.create_user(username='sc_or', password='pw', role='agent')
        cls.boss = User.objects.create_user(username='sc_boss', password='pw', role='boss')
        cls.wm = User.objects.create_user(username='sc_wm', password='pw', role='weight_master')

    def test_agent_and_seller_see_own_customer(self):
        self.assertEqual(customer_ids_for(self.agent), [self.cust_a.pk])
        self.assertEqual(customer_ids_for(self.seller), [self.cust_a.pk])

    def test_agent_without_member_sees_nothing(self):
        self.assertIsNone(member_of(self.orphan))
        self.assertEqual(customer_ids_for(self.orphan), [])

    def test_sales_rep_sees_own_customers(self):
        self.assertEqual(customer_ids_for(self.rep), [self.cust_a.pk])

    def test_staff_sees_all_and_others_nothing(self):
        self.assertIsNone(customer_ids_for(self.boss))
        self.assertEqual(customer_ids_for(self.wm), [])
```

- [ ] **Step 2: Run** — labels `apps.market`. Expected: ImportError (no app).

- [ ] **Step 3: App files**

`apps.py`:
```python
from django.apps import AppConfig


class MarketConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.market'
```

`models/team.py`:
```python
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Bazaar(models.Model):
    """A market where one of the agent's sellers works."""

    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='bazaars')
    name = models.CharField(max_length=60, **cyrillic_collation())
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('market', 'bazaars')
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['customer', 'name'], name='market_bazaar_customer_name_uniq')]

    def __str__(self) -> str:
        return self.name


class AgentMember(models.Model):
    """Binds an external login (role agent / agent_seller) to its agent (core.Customer)."""

    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='agent_member')
    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='agent_members')
    # Sellers only: the bazaar they work at.
    bazaar = models.ForeignKey(Bazaar, on_delete=models.PROTECT, null=True, blank=True, related_name='members')

    class Meta:
        db_table = schema_table('market', 'agent_members')

    def __str__(self) -> str:
        return f'{self.user.username} → {self.customer.name}'
```

`models/__init__.py`:
```python
from apps.market.models.team import AgentMember, Bazaar

__all__ = ['AgentMember', 'Bazaar']
```

`scoping.py`:
```python
"""Which agents (core.Customer ids) a user may see in the market app.

Every market queryset filters through customer_ids_for(), list and detail alike —
unlike export's shipment detail routes, which are deliberately unscoped.
"""
from apps.core.models import Customer
from apps.market.models import AgentMember

STAFF_ALL = frozenset({'admin', 'boss', 'director', 'export_manager', 'document_team'})


def member_of(user) -> AgentMember | None:
    try:
        return user.agent_member
    except AgentMember.DoesNotExist:
        return None


def customer_ids_for(user) -> list[int] | None:
    """None = every customer; [] = none."""
    role = getattr(user, 'role', None)
    if role in ('agent', 'agent_seller'):
        member = member_of(user)
        return [member.customer_id] if member else []
    if role == 'sales_rep':
        return list(Customer.objects.filter(sales_rep=user).values_list('pk', flat=True))
    if role in STAFF_ALL or getattr(user, 'is_superuser', False):
        return None
    return []
```

`urls.py`:
```python
from rest_framework.routers import DefaultRouter

router = DefaultRouter()

urlpatterns = [
    *router.urls,
]
```

Settings: add `'apps.market',` after `'apps.export',` in INSTALLED_APPS. `config/urls.py`: add `path('api/v1/market/', include('apps.market.urls')),` after the export line.

`schema_table('market', 'bazaars')` returns the flat name `market_bazaars` in `dbo` (no MSSQL schema), so nothing else is needed.

- [ ] **Step 4: Migration** — `manage.py makemigrations market` → `0001_initial.py`. Do not `migrate`.

- [ ] **Step 5: Run** — labels `apps.market`. Expected: PASS. Then `makemigrations --check --dry-run`.

- [ ] **Step 6: Commit** (only if authorized)

```bash
git add backend/apps/market backend/config/settings.py backend/config/urls.py
git commit -m "feat(market): app skeleton with Bazaar, AgentMember and scoping"
```

---

### Task 5: Agent logins API (our staff)

**Files:**
- Create: `backend/apps/market/serializers/__init__.py`, `serializers/agents.py`, `views/__init__.py`, `views/agents.py`, `tests/test_agents_api.py`
- Modify: `backend/apps/market/urls.py`

**Interfaces:**
- Consumes: `customer_ids_for`, `AgentMember`, resource `market_agent`.
- Produces: `GET/POST /api/v1/market/agents/`, `PATCH /api/v1/market/agents/{id}/` (id = user id).
  - Response item: `{id, username, first_name, last_name, is_active, customer: {id, name}}`
  - POST body: `{customer_id, username, password, first_name, last_name?}` → 201 item
  - PATCH body: any of `{first_name, last_name, is_active, password}` → 200 item

- [ ] **Step 1: Write the failing tests** — `tests/test_agents_api.py`

```python
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Customer, User
from apps.market.models import AgentMember

URL = '/api/v1/market/agents/'


class AgentLoginsApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = User.objects.create_user(username='al_rep', password='pw', role='sales_rep')
        cls.other_rep = User.objects.create_user(username='al_rep2', password='pw', role='sales_rep')
        cls.admin = User.objects.create_user(username='al_adm', password='pw', role='admin')
        cls.director = User.objects.create_user(username='al_dir', password='pw', role='director')
        cls.cust = Customer.objects.create(name='Агент К', sales_rep=cls.rep)
        cls.foreign = Customer.objects.create(name='Агент Ч', sales_rep=cls.other_rep)

    def _as(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _body(self, customer, username='agent_k'):
        return {'customer_id': customer.pk, 'username': username, 'password': 'Strong-Pass-71', 'first_name': 'Канат'}

    def test_rep_creates_login_for_own_customer(self):
        resp = self._as(self.rep).post(URL, self._body(self.cust), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username='agent_k')
        self.assertEqual(user.role, 'agent')
        self.assertTrue(user.check_password('Strong-Pass-71'))
        self.assertEqual(AgentMember.objects.get(user=user).customer, self.cust)
        self.assertEqual(resp.json()['customer'], {'id': self.cust.pk, 'name': 'Агент К'})

    def test_rep_cannot_create_for_foreign_customer(self):
        resp = self._as(self.rep).post(URL, self._body(self.foreign), format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(username='agent_k').exists())

    def test_director_is_read_only(self):
        self.assertEqual(self._as(self.director).get(URL).status_code, 200)
        self.assertEqual(self._as(self.director).post(URL, self._body(self.cust), format='json').status_code, 403)

    def test_list_is_scoped_for_rep(self):
        self._as(self.admin).post(URL, self._body(self.cust, 'a1'), format='json')
        self._as(self.admin).post(URL, self._body(self.foreign, 'a2'), format='json')
        names = {row['username'] for row in self._as(self.rep).get(URL).json()['results']}
        self.assertEqual(names, {'a1'})

    def test_patch_deactivates_and_resets_password(self):
        uid = self._as(self.admin).post(URL, self._body(self.cust), format='json').json()['id']
        resp = self._as(self.rep).patch(f'{URL}{uid}/', {'is_active': False, 'password': 'New-Pass-9932'}, format='json')
        self.assertEqual(resp.status_code, 200)
        user = User.objects.get(pk=uid)
        self.assertFalse(user.is_active)
        self.assertTrue(user.check_password('New-Pass-9932'))

    def test_weak_password_rejected(self):
        body = self._body(self.cust) | {'password': '123'}
        self.assertEqual(self._as(self.rep).post(URL, body, format='json').status_code, 400)

    def test_duplicate_username_rejected(self):
        self._as(self.rep).post(URL, self._body(self.cust), format='json')
        self.assertEqual(self._as(self.rep).post(URL, self._body(self.cust), format='json').status_code, 400)
```

(If the project's pagination does not wrap lists in `results`, check `REST_FRAMEWORK['DEFAULT_PAGINATION_CLASS']` in settings and the `api-contract` skill, and adjust the list assertion — not the API shape.)

- [ ] **Step 2: Run** — labels `apps.market.tests.test_agents_api`. Expected: 404s (no route).

- [ ] **Step 3: Serializer** — `serializers/agents.py`

```python
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from apps.core.models import Customer, User
from apps.market.models import AgentMember


class CustomerRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class AgentLoginSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), write_only=True, source='customer_obj')
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'customer', 'customer_id', 'password']
        read_only_fields = ['id']

    def get_customer(self, user) -> dict:
        c = user.agent_member.customer
        return {'id': c.pk, 'name': c.name}

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('password'):
            raise serializers.ValidationError({'password': 'Required.'})
        if self.instance is not None:
            attrs.pop('customer_obj', None)  # an agent login never moves to another customer
            attrs.pop('username', None)
        return attrs

    @transaction.atomic
    def create(self, validated):
        customer = validated.pop('customer_obj')
        password = validated.pop('password')
        user = User(role='agent', **validated)
        user.set_password(password)
        user.save()
        AgentMember.objects.create(user=user, customer=customer)
        return user

    def update(self, user, validated):
        password = validated.pop('password', None)
        for key, value in validated.items():
            setattr(user, key, value)
        if password:
            user.set_password(password)
        user.save()
        return user
```

- [ ] **Step 4: View** — `views/agents.py`

```python
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.core.models import User
from apps.core.permissions import DynamicResourcePermission
from apps.market.scoping import customer_ids_for
from apps.market.serializers.agents import AgentLoginSerializer


class AgentLoginViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                        mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Our staff create and manage agent logins (role `agent`)."""

    resource_code = 'market_agent'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = AgentLoginSerializer
    http_method_names = ['get', 'post', 'patch']

    def get_queryset(self):
        qs = User.objects.filter(role='agent', agent_member__isnull=False).select_related('agent_member__customer')
        ids = customer_ids_for(self.request.user)
        if ids is not None:
            qs = qs.filter(agent_member__customer_id__in=ids)
        return qs.order_by('agent_member__customer__name', 'username')

    def perform_create(self, serializer):
        ids = customer_ids_for(self.request.user)
        customer = serializer.validated_data['customer_obj']
        if ids is not None and customer.pk not in ids:
            raise PermissionDenied('Not your customer.')
        serializer.save()
```

`views/__init__.py`: `from apps.market.views.agents import AgentLoginViewSet` + `__all__`. `serializers/__init__.py`: empty.
`urls.py`: `router.register('agents', AgentLoginViewSet, basename='market-agents')` (import from `apps.market.views`).

- [ ] **Step 5: Run** — labels `apps.market`. Expected: PASS.

- [ ] **Step 6: Commit** (only if authorized)

```bash
git add backend/apps/market
git commit -m "feat(market): agent logins API for staff"
```

---

### Task 6: Agent team API (bazaars, seller logins) and `market/me`

**Files:**
- Create: `backend/apps/market/serializers/team.py`, `views/team.py`, `tests/test_team_api.py`
- Modify: `backend/apps/market/urls.py`, `views/__init__.py`

**Interfaces:**
- Consumes: `member_of`, `customer_ids_for`, resource `market_team`.
- Produces:
  - `GET /api/v1/market/me/` → `{role, customer: {id, name} | null, bazaar: {id, name} | null}` (any authenticated user; null customer for staff).
  - `GET/POST /api/v1/market/team/bazaars/`, `PATCH .../{id}/` — item `{id, name, city_id, is_active}`; agent only writes; customer forced to the agent's own.
  - `GET/POST /api/v1/market/team/sellers/`, `PATCH .../{id}/` — item `{id, username, first_name, last_name, is_active, bazaar: {id, name}}`; POST `{username, password, first_name, last_name?, bazaar_id}`; PATCH `{first_name, last_name, is_active, password, bazaar_id}`.

- [ ] **Step 1: Write the failing tests** — `tests/test_team_api.py`

```python
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Customer, User
from apps.market.models import AgentMember, Bazaar


class TeamApiTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.cust = Customer.objects.create(name='Агент Т')
        cls.other = Customer.objects.create(name='Агент О')
        cls.agent = User.objects.create_user(username='tm_ag', password='pw', role='agent')
        AgentMember.objects.create(user=cls.agent, customer=cls.cust)
        cls.other_agent = User.objects.create_user(username='tm_ag2', password='pw', role='agent')
        AgentMember.objects.create(user=cls.other_agent, customer=cls.other)
        cls.foreign_bazaar = Bazaar.objects.create(customer=cls.other, name='Чужой')
        cls.boss = User.objects.create_user(username='tm_boss', password='pw', role='boss')

    def _as(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _bazaar(self, name='Зелёный'):
        return self._as(self.agent).post('/api/v1/market/team/bazaars/', {'name': name}, format='json')

    def test_agent_creates_bazaar_for_own_customer(self):
        resp = self._bazaar()
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(Bazaar.objects.get(pk=resp.json()['id']).customer, self.cust)

    def test_agent_cannot_touch_foreign_bazaar(self):
        resp = self._as(self.agent).patch(f'/api/v1/market/team/bazaars/{self.foreign_bazaar.pk}/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_agent_creates_seller_login(self):
        bazaar_id = self._bazaar().json()['id']
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_1', 'password': 'Strong-Pass-71', 'first_name': 'Айдос', 'bazaar_id': bazaar_id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(username='seller_1')
        self.assertEqual(user.role, 'agent_seller')
        self.assertEqual(user.agent_member.customer, self.cust)
        self.assertEqual(user.agent_member.bazaar_id, bazaar_id)

    def test_seller_bazaar_must_be_own(self):
        resp = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_x', 'password': 'Strong-Pass-71', 'first_name': 'X', 'bazaar_id': self.foreign_bazaar.pk,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_deactivated_seller_hidden_from_active_list_and_cannot_log_in(self):
        bazaar_id = self._bazaar().json()['id']
        sid = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_2', 'password': 'Strong-Pass-71', 'first_name': 'Б', 'bazaar_id': bazaar_id,
        }, format='json').json()['id']
        self._as(self.agent).patch(f'/api/v1/market/team/sellers/{sid}/', {'is_active': False}, format='json')
        active = self._as(self.agent).get('/api/v1/market/team/sellers/?active=1').json()['results']
        self.assertNotIn(sid, [row['id'] for row in active])
        self.assertTrue(User.objects.filter(pk=sid, is_active=False).exists())
        login = APIClient().post('/api/v1/auth/login/', {'username': 'seller_2', 'password': 'Strong-Pass-71'}, format='json')
        self.assertNotEqual(login.status_code, 200)

    def test_seller_and_other_agent_cannot_see_team(self):
        bazaar_id = self._bazaar().json()['id']
        sid = self._as(self.agent).post('/api/v1/market/team/sellers/', {
            'username': 'seller_3', 'password': 'Strong-Pass-71', 'first_name': 'В', 'bazaar_id': bazaar_id,
        }, format='json').json()['id']
        seller = User.objects.get(pk=sid)
        self.assertEqual(self._as(seller).get('/api/v1/market/team/sellers/').status_code, 403)
        ids = [r['id'] for r in self._as(self.other_agent).get('/api/v1/market/team/sellers/').json()['results']]
        self.assertNotIn(sid, ids)

    def test_boss_reads_but_cannot_write_team(self):
        self.assertEqual(self._as(self.boss).get('/api/v1/market/team/bazaars/').status_code, 200)
        # boss holds VCRUD by convention, but team writes are the agent's own:
        resp = self._as(self.boss).post('/api/v1/market/team/bazaars/', {'name': 'x'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_me(self):
        body = self._as(self.agent).get('/api/v1/market/me/').json()
        self.assertEqual(body, {'role': 'agent', 'customer': {'id': self.cust.pk, 'name': 'Агент Т'}, 'bazaar': None})
        self.assertEqual(self._as(self.boss).get('/api/v1/market/me/').json()['customer'], None)
```

- [ ] **Step 2: Run** — labels `apps.market.tests.test_team_api`. Expected: 404s.

- [ ] **Step 3: Serializers** — `serializers/team.py`

```python
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from apps.core.models import User
from apps.market.models import AgentMember, Bazaar


class BazaarSerializer(serializers.ModelSerializer):
    city_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Bazaar
        fields = ['id', 'name', 'city_id', 'is_active']


class SellerSerializer(serializers.ModelSerializer):
    bazaar = serializers.SerializerMethodField()
    bazaar_id = serializers.IntegerField(write_only=True, required=False)
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'bazaar', 'bazaar_id', 'password']
        read_only_fields = ['id']

    def get_bazaar(self, user) -> dict | None:
        b = user.agent_member.bazaar
        return {'id': b.pk, 'name': b.name} if b else None

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_bazaar_id(self, value):
        customer = self.context['customer']
        if not Bazaar.objects.filter(pk=value, customer=customer, is_active=True).exists():
            raise serializers.ValidationError('Unknown bazaar.')
        return value

    def validate(self, attrs):
        if self.instance is None:
            for key in ('password', 'bazaar_id'):
                if not attrs.get(key):
                    raise serializers.ValidationError({key: 'Required.'})
        else:
            attrs.pop('username', None)
        return attrs

    @transaction.atomic
    def create(self, validated):
        password = validated.pop('password')
        bazaar_id = validated.pop('bazaar_id')
        user = User(role='agent_seller', **validated)
        user.set_password(password)
        user.save()
        AgentMember.objects.create(user=user, customer=self.context['customer'], bazaar_id=bazaar_id)
        return user

    @transaction.atomic
    def update(self, user, validated):
        password = validated.pop('password', None)
        bazaar_id = validated.pop('bazaar_id', None)
        for key, value in validated.items():
            setattr(user, key, value)
        if password:
            user.set_password(password)
        user.save()
        if bazaar_id:
            AgentMember.objects.filter(user=user).update(bazaar_id=bazaar_id)
        return user
```

- [ ] **Step 4: Views** — `views/team.py`

```python
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import User
from apps.core.permissions import DynamicResourcePermission
from apps.market.models import Bazaar
from apps.market.scoping import customer_ids_for, member_of
from apps.market.serializers.team import BazaarSerializer, SellerSerializer


class _TeamBase(mixins.ListModelMixin, mixins.CreateModelMixin,
                mixins.UpdateModelMixin, viewsets.GenericViewSet):
    resource_code = 'market_team'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    http_method_names = ['get', 'post', 'patch']

    def _scope(self, qs, field='customer_id'):
        ids = customer_ids_for(self.request.user)
        return qs if ids is None else qs.filter(**{f'{field}__in': ids})

    def _own_customer(self):
        """Team writes belong to the agent itself — staff only read."""
        member = member_of(self.request.user)
        if self.request.user.role != 'agent' or member is None:
            raise PermissionDenied('Only the agent manages its team.')
        return member.customer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            ctx['customer'] = self._own_customer()
        return ctx


class BazaarViewSet(_TeamBase):
    serializer_class = BazaarSerializer

    def get_queryset(self):
        return self._scope(Bazaar.objects.all())

    def perform_create(self, serializer):
        serializer.save(customer=self._own_customer())


class SellerViewSet(_TeamBase):
    serializer_class = SellerSerializer

    def get_queryset(self):
        qs = User.objects.filter(role='agent_seller', agent_member__isnull=False).select_related('agent_member__bazaar')
        if self.request.query_params.get('active') == '1':
            qs = qs.filter(is_active=True)
        return self._scope(qs, 'agent_member__customer_id').order_by('first_name', 'username')


class MarketMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = member_of(request.user)
        return Response({
            'role': request.user.role,
            'customer': {'id': member.customer_id, 'name': member.customer.name} if member else None,
            'bazaar': ({'id': member.bazaar_id, 'name': member.bazaar.name}
                       if member and member.bazaar_id else None),
        })
```

Note: a PATCH on a foreign id returns 404 because `get_queryset` is scoped before `get_object`; `get_serializer_context` raising for staff PATCH/POST gives 403 — both are what the tests expect. Bazaar `city_id`: when set, validate in `BazaarSerializer.validate_city_id` that `City` exists (`City.objects.filter(pk=value).exists()`), else 400.

`urls.py`:
```python
from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.market.views import AgentLoginViewSet, BazaarViewSet, MarketMeView, SellerViewSet

router = DefaultRouter()
router.register('agents', AgentLoginViewSet, basename='market-agents')
router.register('team/bazaars', BazaarViewSet, basename='market-bazaars')
router.register('team/sellers', SellerViewSet, basename='market-sellers')

urlpatterns = [
    path('me/', MarketMeView.as_view(), name='market-me'),
    *router.urls,
]
```

- [ ] **Step 5: Run** — labels `apps.market apps.core.tests_external_role_fence`. Expected: PASS. If `test_deactivated_seller..._cannot_log_in` gets 200 from login, the login view does not check `is_active` — stop and report (do not change auth in this task).

- [ ] **Step 6: Commit** (only if authorized)

```bash
git add backend/apps/market
git commit -m "feat(market): agent team API (bazaars, seller logins) and market/me"
```

---

### Task 7: Frontend role plumbing

**Files:**
- Modify: `frontend/src/types/index.ts` (UserRole union), `frontend/src/constants/roles.ts` (ROLE_CHOICES + `EXTERNAL_ROLES`), `frontend/src/pages/admin/permissions/roleColors.ts`, `frontend/src/pages/admin/UsersPage.tsx` (ROLE_COLORS only — **not** `ALL_ROLES`), `frontend/src/i18n/{ru,tk,en}.json` (`roles.agent`, `roles.agent_seller`), `frontend/src/App.tsx:120-126` (root route element), `frontend/src/pages/auth/LoginPage.tsx:33` (post-login navigate)
- Create: `frontend/src/components/ExternalRoleGate.tsx`
- Test: `frontend/src/components/ExternalRoleGate.test.tsx`

Agent logins are created only through the market API (they need an `AgentMember`), so the roles are **not** added to `UsersPage`'s `ALL_ROLES` create list.

**Why a gate and not just `IndexRoute`:** `/` renders `<ProtectedRoute><AppLayout/></ProtectedRoute>`; `AppLayout` (header, bell, season, task counts) mounts **before** `IndexRoute` and fires internal API calls that the fence answers with 403. `services/api.ts` handles 403 silently (only 401 redirects, only 409 toasts), so nothing breaks visibly — but no internal request should leave an agent's browser at all. So external roles leave for `/m/` **before** `AppLayout` mounts, and login sends them there directly. `/m/` is a different bundle (Task 9), so this is a full page load (`window.location.replace`), not a router `Navigate`.

- [ ] **Step 1: Write the failing test** — `ExternalRoleGate.test.tsx`: mock `@/hooks/useAuth` (search an existing test for `vi.mock('@/hooks/useAuth'`), stub `window.location.replace` (`vi.stubGlobal` or `Object.defineProperty(window, 'location', { value: { ...window.location, replace: vi.fn() } })`) and render `<ExternalRoleGate><div>app-layout</div></ExternalRoleGate>`.
  Assert: role `agent` → `replace` called with `'/m/'` and `app-layout` not rendered; same for `agent_seller`; role `export_manager` → `app-layout` rendered, `replace` not called.

- [ ] **Step 2: Run** — `npx vitest run src/components/ExternalRoleGate.test.tsx` → FAIL.

- [ ] **Step 3: Implement**
  - `types/index.ts`: add `| 'agent'` and `| 'agent_seller'` before `| 'boss'`.
  - `constants/roles.ts`: add `{ value: 'agent', labelKey: 'roles.agent' }, { value: 'agent_seller', labelKey: 'roles.agent_seller' },` before boss.
  - `roleColors.ts` and `UsersPage.tsx` `ROLE_COLORS`: `agent: 'lime', agent_seller: 'green',` (same values in both; the files say they must match).
  - i18n: `ru` «Агент» / «Продавец агента»; `tk` «Agent» / «Agentiň satyjysy»; `en` «Agent» / «Agent seller».
  - `constants/roles.ts`: `export const EXTERNAL_ROLES: ReadonlyArray<UserRole> = ['agent', 'agent_seller'];`
  - `components/ExternalRoleGate.tsx`:
    ```tsx
    import { useEffect } from 'react';
    import { useAuth } from '@/hooks/useAuth';
    import { EXTERNAL_ROLES } from '@/constants/roles';

    /** Agents and their sellers use the separate market app at /m/; the internal AppLayout must never mount for them. */
    export function ExternalRoleGate({ children }: { children: React.ReactNode }) {
      const { user } = useAuth();
      const external = Boolean(user && EXTERNAL_ROLES.includes(user.role));
      useEffect(() => {
        if (external) window.location.replace('/m/');
      }, [external]);
      if (external) return null;
      return <>{children}</>;
    }
    ```
  - `App.tsx` root route: `<ProtectedRoute><ExternalRoleGate><AppLayout /></ExternalRoleGate></ProtectedRoute>`.
  - `LoginPage.tsx:33`: external roles always leave for the market app:
    ```tsx
    if (EXTERNAL_ROLES.includes(data.role)) {
      window.location.replace('/m/');
      return;
    }
    navigate(next ?? (data.role === 'boss' ? '/boss/dashboard' : '/'));
    ```
    Add a case to `pages/auth/LoginPage.test.tsx`: login response with `role: 'agent'` → `window.location.replace('/m/')`.
- [ ] **Step 4: Run** — `npx vitest run src/components/ExternalRoleGate.test.tsx src/pages/auth/LoginPage.test.tsx` → PASS; `npx tsc --noEmit --ignoreDeprecations 5.0` → no new errors.
- [ ] **Step 5: Commit** (only if authorized) — `git add` the files above; `git commit -m "feat(frontend): agent and agent_seller roles"`.

---

### Task 8: Desktop «Логины агентов» page

**Files:**
- Create: `frontend/src/hooks/useAgentLogins.ts`, `frontend/src/pages/market/AgentLoginsPage.tsx`, `frontend/src/pages/market/AgentLoginsPage.test.tsx`
- Modify: `frontend/src/App.tsx` (route inside the `AppLayout` block), `frontend/src/components/AppLayout.tsx` (menu item, page-code gated like neighbours), i18n ×3 (`market.agents.*`)

**Interfaces:**
- Consumes: `GET/POST /market/agents/`, `PATCH /market/agents/{id}/`, `GET /core/customers/` (existing, for the customer select).
- Produces: `useAgentLogins()`, `useCreateAgentLogin()`, `useUpdateAgentLogin()`; type `IAgentLogin { id: number; username: string; first_name: string; last_name: string; is_active: boolean; customer: { id: number; name: string } }`.

- [ ] **Step 1: Write the failing test** — mock `@/services/api` (pattern: any `*.test.tsx` that mocks `api.get`), return two agent logins, render the page, assert both usernames and customer names are in the table; click «Добавить логин», fill username/password/name, pick a customer, submit, assert `api.post` called with `/market/agents/` and `{customer_id, username, password, first_name}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Hook** — `useAgentLogins.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export interface IAgentLogin {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  customer: { id: number; name: string };
}

export interface IAgentLoginCreate {
  customer_id: number;
  username: string;
  password: string;
  first_name: string;
  last_name?: string;
}

const KEY = ['market', 'agents'] as const;

export function useAgentLogins() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<{ results: IAgentLogin[] }>('/market/agents/')).data.results,
  });
}

export function useCreateAgentLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: IAgentLoginCreate) => (await api.post<IAgentLogin>('/market/agents/', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAgentLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; is_active?: boolean; password?: string; first_name?: string }) =>
      (await api.patch<IAgentLogin>(`/market/agents/${id}/`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- [ ] **Step 4: Page** — `AgentLoginsPage.tsx`: Ant Design `Table` (columns: agent/customer, login, name, active switch → `useUpdateAgentLogin`, «Сменить пароль» button → modal with one password field), header button «Добавить логин» → `Modal` + `Form` (customer `Select` from the existing customers hook — search `useCustomers` in `src/hooks`; username; password; first/last name). Show `canDo('market_agent', 'create')`-gated buttons using the existing `canDo` helper from `utils/permissions.ts` (check its exact signature there). Errors: show the server's field messages under the fields (`form.setFields`). All texts via `t('market.agents.…')`.
- [ ] **Step 5: Route + menu** — `App.tsx` inside the `AppLayout` routes: `<Route path="market/agents" element={<ProtectedRoute pageCode="market.agents"><AgentLoginsPage /></ProtectedRoute>} />` (lazy import like neighbours). `AppLayout.tsx`: add a menu item `/market/agents` with label `t('market.agents.nav')` in the same group as `'/admin/customers'`, gated by page code like its neighbours.
- [ ] **Step 6: Run** — vitest file → PASS; tsc → clean.
- [ ] **Step 7: Commit** (only if authorized) — `git commit -m "feat(frontend): agent logins page"`.

---

### Task 9: Separate market app at `/m/` (shell, login, home, agent team screen)

**Files:**
- Create: `frontend/m.html`, `frontend/src/market-app/main.tsx`, `src/market-app/App.tsx`, `src/market-app/styles/tokens.css`, `src/market-app/styles/base.css`, `src/market-app/screens/LoginScreen.tsx`, `src/market-app/screens/Shell.tsx`, `src/market-app/screens/HomeScreen.tsx` (placeholder «Машин пока нет» — lots arrive in Part B), `src/market-app/screens/TeamScreen.tsx`, `src/market-app/components/Sheet.tsx`, `src/market-app/hooks/useMarketMe.ts`, `src/market-app/hooks/useMarketTeam.ts`, tests `src/market-app/screens/TeamScreen.test.tsx`, `src/market-app/screens/LoginScreen.test.tsx`
- Modify: `frontend/vite.config.ts` (second entry + dev fallback), `frontend/nginx.conf` (`location /m/`), `frontend/src/utils/loginRedirect.ts` (401 inside `/m/` → `/m/login`), i18n ×3 (`market.shell.*`, `market.login.*`, `market.team.*`)

**Interfaces:**
- Consumes: `POST /auth/login/`, `POST /auth/logout/`, `GET /market/me/`, `GET/POST/PATCH /market/team/bazaars/`, `GET/POST/PATCH /market/team/sellers/`.
- Produces: `useMarketMe()` → `{ role: 'agent' | 'agent_seller' | string; customer: {id,name}|null; bazaar: {id,name}|null }`; `useBazaars()`, `useSaveBazaar()`, `useSellers()`, `useSaveSeller()`; components `Shell`, `Sheet` (top-pinned modal) reused by Parts B–D.

- [ ] **Step 1: Write the failing tests**
  - `TeamScreen.test.tsx` (mock `@/services/api`): two bazaars, one seller → the row shows «Айдос, Зелёный»; tap «Добавить продавца», fill login / password / name, choose bazaar, «Сохранить» → `api.post('/market/team/sellers/', { username, password, first_name, bazaar_id })`; tap the seller's «Отключить» → `api.patch('/market/team/sellers/<id>/', { is_active: false })`; a 400 `{ username: ['…'] }` from the post is shown under the login field.
  - `LoginScreen.test.tsx`: submit → `api.post('/auth/login/', {username, password})`; response role `agent_seller` → navigates to `/` (router basename `/m`); response role `export_manager` → `window.location.replace('/')` (staff belong in the main app).
- [ ] **Step 2: Run** — `npx vitest run src/market-app` → FAIL.
- [ ] **Step 3: Build wiring**
  - `frontend/m.html` (copy `index.html`'s head basics; Sofia Sans from Google Fonts like the artifact; manifest link is added in Task 10):
    ```html
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#D4271D" />
        <title>YGT Продажа</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;600;800&family=Sofia+Sans+Condensed:wght@700;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/market-app/main.tsx"></script>
      </body>
    </html>
    ```
  - `vite.config.ts`: add
    ```ts
    build: {
      rollupOptions: {
        input: { main: resolve(__dirname, 'index.html'), m: resolve(__dirname, 'm.html') },
      },
    },
    ```
    and a dev plugin so `/m/...` deep links serve `m.html` in `npm run dev`:
    ```ts
    const marketAppFallback = {
      name: 'market-app-fallback',
      configureServer(server: import('vite').ViteDevServer) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && (req.url === '/m' || (req.url.startsWith('/m/') && !req.url.includes('.')))) req.url = '/m.html';
          next();
        });
      },
    };
    // plugins: [react(), marketAppFallback],
    ```
  - `nginx.conf`: before `location / {`:
    ```nginx
    # Agent market app (separate Vite entry m.html) — its own SPA fallback.
    location /m/ {
        try_files $uri /m.html;
    }
    ```
  - `loginRedirect.ts` `loginPathFor`: first line
    ```ts
    if (path.startsWith('/m/') || path === '/m') return path.startsWith('/m/login') ? path : `/m/login?next=${encodeURIComponent(path)}`;
    ```
    and add a case to its existing test file (search `loginRedirect.test`) — `/m/team` → `/m/login?next=%2Fm%2Fteam`.
- [ ] **Step 4: App code**
  - `main.tsx`: `import '@/i18n'`; `import './styles/tokens.css'`; `import './styles/base.css'`; `QueryClientProvider` (new `QueryClient`, `retry: 1`); `BrowserRouter basename="/m"`; `<App />`. No `antd` import anywhere under `src/market-app/` (Global Constraints).
  - `App.tsx` routes: `/login` → `LoginScreen`; everything else inside `Shell` (which loads `useMarketMe()`; on 401 the api interceptor already redirects to `/m/login`): index → `HomeScreen`; `team` → `TeamScreen` only when `me.role === 'agent'`, else redirect to index.
  - `styles/tokens.css` — the artifact's tokens verbatim (spec §9), incl. dark:
    ```css
    :root{
      --bg:#F2F5F0; --card:#FFFFFF; --ink:#18261E; --muted:#56665C; --line:#D2DBD3;
      --tomato:#D4271D; --tomato-ink:#FFFFFF; --vine:#1B7438; --vine-soft:#E1F1E5;
      --crate:#8F5C00; --crate-soft:#FAEED3; --empty:#E2E8E2; --focus:#1463D8; --shade:rgba(12,22,16,.55);
    }
    @media (prefers-color-scheme: dark){
      :root{
        --bg:#0F1512; --card:#19221D; --ink:#EDF2ED; --muted:#9DADA2; --line:#2E3C34;
        --tomato:#FF6A5E; --tomato-ink:#2A0A07; --vine:#55C982; --vine-soft:#173123;
        --crate:#E6B255; --crate-soft:#35290F; --empty:#27332C; --focus:#7FB2FF; --shade:rgba(0,0,0,.65);
      }
    }
    ```
  - `styles/base.css` — port from the artifact (the HTML in the user's paste / `docs/research/tomato-sales-app-study.md` §7): body font `17px/1.4 "Sofia Sans"`, `.num` condensed tabular, `.mk-app{max-width:1200px;margin:0 auto;padding:16px 16px 110px}` (24 px side padding from 700 px), buttons `.mk-btn` (min-height 56 px, radius 16 px, 2 px border), primary `.mk-btn--tomato` (min-height 68 px), `.mk-field` (height 64 px, radius 16 px), `.mk-list{display:grid;gap:12px}` with `@media (min-width:760px){grid-template-columns:1fr 1fr}` and `@media (min-width:1100px){grid-template-columns:repeat(3,minmax(0,1fr))}`, `:focus-visible{outline:3px solid var(--focus)}`, safe-area padding. Prefix every class `mk-`; no element selectors except `html, body, button, input`.
  - `Sheet.tsx`: overlay `position:fixed; inset:0`, panel max-width 480 px **pinned to the top** on phones (keyboard), centered from 700 px; closes on Esc and backdrop; `role="dialog" aria-modal="true"`.
  - `Shell.tsx`: header (brand «Продажа» condensed 26–34 px, `customer.name`, user first name, «Выйти» → `api.post('/auth/logout/')` then `window.location.replace('/m/login')`); for the agent a bottom bar «Машины» / «Команда» (64 px tall, fixed, safe-area aware); `<Outlet/>`.
  - `LoginScreen.tsx`: two `mk-field` inputs + `mk-btn--tomato` «Войти»; after login: external role → `navigate(safeNext ?? '/')` within the app; any other role → `window.location.replace('/')`.
  - `TeamScreen.tsx` as described in the test: «Базары» (list, «Добавить базар» sheet with name) and «Продавцы» (cards «Имя, Базар», active state, «Сменить пароль», «Отключить»/«Включить», «Добавить продавца» sheet with login / password / name / bazaar `<select class="mk-field">`). Server field errors under the fields.
- [ ] **Step 5: Build check** — `npm run build` must emit both `index.html` and `m.html`. There is no agent login on the shared DB and the branch's migrations are not applied there, so do **not** create agents to click through it; the visual phone / tablet / desktop check is the user's (logged in BUILD_TEST_LOG, Task 11). Only `npm run dev` → open `/m/login` (no login needed) at 360, 768 and 1280 px widths and confirm no horizontal scroll.
- [ ] **Step 6: Run** — `npx vitest run src/market-app src/utils` → PASS; tsc → clean; `npm run build` → PASS.
- [ ] **Step 7: Commit** (only if authorized) — `git commit -m "feat(frontend): separate market app at /m/ with login, shell and team screen"`.

---

### Task 10: PWA (installable on the seller's phone)

**Files:**
- Create: `frontend/public/m/manifest.webmanifest`, `frontend/public/m/sw.js`, `frontend/public/m/icon-192.png`, `frontend/public/m/icon-512.png`, `frontend/public/m/icon-maskable-512.png`, `frontend/public/m/apple-touch-icon.png` (180×180), `frontend/src/market-app/registerSw.ts`, test `frontend/src/market-app/manifest.test.ts`
- Modify: `frontend/m.html` (manifest + apple tags), `frontend/src/market-app/main.tsx` (register SW), `frontend/nginx.conf` (no-cache for `sw.js` and the manifest)

- [ ] **Step 1: Write the failing test** — `manifest.test.ts` reads `public/m/manifest.webmanifest` with `fs` and asserts: `start_url === '/m/'`, `scope === '/m/'`, `display === 'standalone'`, `lang === 'ru'`, icons include `192x192` and `512x512` PNG and one `purpose: 'maskable'`, and every icon `src` file exists under `public/`.
- [ ] **Step 2: Run** — `npx vitest run src/market-app/manifest.test.ts` → FAIL.
- [ ] **Step 3: Implement**
  - `manifest.webmanifest`:
    ```json
    {
      "name": "YGT Продажа",
      "short_name": "Продажа",
      "lang": "ru",
      "start_url": "/m/",
      "scope": "/m/",
      "display": "standalone",
      "background_color": "#F2F5F0",
      "theme_color": "#D4271D",
      "icons": [
        { "src": "/m/icon-192.png", "sizes": "192x192", "type": "image/png" },
        { "src": "/m/icon-512.png", "sizes": "512x512", "type": "image/png" },
        { "src": "/m/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
      ]
    }
    ```
  - Icons: render `public/icon.svg` and `public/icon-maskable.svg` to the PNG sizes. Check `magick -version` or `npx --yes sharp-cli --version`; use whichever works (no new package.json dependency). If neither works, stop and ask the user for PNG icons — do not ship without PNGs (Android will not offer install).
  - `sw.js` — installability only, **no caching** (online-only; a cache would pin sellers to an old build):
    ```js
    // Market app service worker: exists so Android offers "Install". No caching on purpose —
    // the app is online-only and must always load the current build.
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', () => {});
    ```
  - `registerSw.ts`:
    ```ts
    export function registerMarketSw(): void {
      if (import.meta.env.PROD && 'serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' }).catch(() => {});
        });
      }
    }
    ```
    call it from `main.tsx`.
  - `m.html` head: `<link rel="manifest" href="/m/manifest.webmanifest" />`, `<link rel="apple-touch-icon" href="/m/apple-touch-icon.png" />`, `<meta name="apple-mobile-web-app-capable" content="yes" />`, `<meta name="apple-mobile-web-app-title" content="Продажа" />`.
  - `nginx.conf`, inside/next to `location /m/`:
    ```nginx
    location = /m/sw.js { add_header Cache-Control "no-cache"; try_files $uri =404; }
    location = /m/manifest.webmanifest { add_header Cache-Control "no-cache"; default_type application/manifest+json; try_files $uri =404; }
    ```
- [ ] **Step 4: Run** — `npx vitest run src/market-app` → PASS; `npm run build` → `dist/m/manifest.webmanifest` and `dist/m/sw.js` present.
- [ ] **Step 5: Commit** (only if authorized) — `git commit -m "feat(frontend): market app installable as a PWA"`.

---

### Task 11: Docs and logs

**Files:**
- Create: `docs/obsidian/modules/market.md` (or the folder the vault index uses for modules — check `docs/obsidian/00-index.md`), `docs/obsidian/roles/agent.md`, `docs/obsidian/roles/agent-seller.md`
- Modify: `docs/obsidian/00-index.md`, `docs/obsidian/processes/permissions-system.md` (fence + new codes), `.claude/skills/api-contract/SKILL.md` (market endpoints of Tasks 5–6), `CHANGELOG.md` ([Unreleased] → Added), `BUILD_TEST_LOG.md` (new top entry `- [ ] 2026-10-08 — Agent market part A: roles, API fence, agent logins, /m/ app + PWA, team screen — NEEDS TEST (check phone, tablet, desktop; install PWA on Android + iPhone)`)

- [ ] **Step 1:** Write the notes: what part A does, the fence rule, page/resource codes and grants table (Task 3), endpoints and shapes (Tasks 5–6), "agent logins only via `/market/agents/`, not the Users page", "branch migrations not applied to the shared DB until merge", "the market app is a second Vite entry served at `/m/`; deploy needs the frontend image rebuilt (nginx `location /m/`), PWA install needs HTTPS".
- [ ] **Step 2:** Full run — labels `apps.market apps.core.tests_agent_roles apps.core.tests_external_role_fence apps.core.tests_agent_perms apps.core.tests_boss_access apps.core.tests_garawul apps.export.tests_sheet_perms`; `npx vitest run src/pages/market src/market-app src/components/ExternalRoleGate.test.tsx src/pages/auth/LoginPage.test.tsx`; `npm run build` (both entries build); tsc. Report counts.
- [ ] **Step 3: Commit** (only if authorized) — `git commit -m "docs: agent market part A — vault, api contract, changelog, test log"`.

---

## Role touch-list items deliberately skipped (spec §3)

- `seed_test_users.py` (core): an agent login without an `AgentMember` sees nothing, and `core` cannot create one (no `core → market` import). If test logins are wanted, add a `market` management command in Part B.
- `export/services/comments.py` `_VALID_ROLES`: agents are fenced off export comments, so the roles do not go in.
- Sheet `WHO_TO_ROLE` / `sheetRoleBlocks.ts` / `TaskCardEditor.helpers.ts`: agents own no Sheet rows and no task cards.

## After Part A

Every reference list an agent's phone needs must be served under `/api/v1/market/` from Part B on — expense categories, cities, product types are all behind the fence today.

Parts B (lots, sales, spoilage, expenses, status driving, QR claim), C (buyers, payments), D (panels, analytics, Excel) and E (SalesReport build) get their own plans, written against the code this plan produced.
