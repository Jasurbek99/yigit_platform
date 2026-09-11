# Sheet Settings as the Permission Authority — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SheetRowSetting` the single authority for who may edit a Sheet-owned shipment field, administered from one new tab in Shipment Settings that `export_manager` can use without an admin account.

**Architecture:** `can_edit_sheet_field` stops AND-ing the `RoleFieldPermission` grant — trigger config alone decides. The real write gate (`ShipmentPatchSerializer`) switches from `can_edit_field` to the same sheet gate, so display and write agree by construction. A reverse-delegate map routes fields written by composite Sheet cells (`box_count`, `truck_head_id`, …) to their owning row. A backfill migration copies today's `RoleFieldPermission` grants into `triggered_roles` so nobody loses access, and a new `sheet_row_setting` resource stops non-admin roles from self-granting through the settings endpoint.

**Tech Stack:** Django 5 + DRF + MSSQL (django-mssql-backend), React 18 + TypeScript + Ant Design + TanStack Query + vitest.

**Spec:** [docs/superpowers/specs/2026-09-02-sheet-settings-as-permission-authority-design.md](../specs/2026-09-02-sheet-settings-as-permission-authority-design.md)

## Global Constraints

- **MSSQL**: no `JSONField`, no `ArrayField`, no `DISTINCT ON`; every `bulk_create`/`bulk_update` passes `batch_size=500`.
- **Status transitions**: never touch `status_id` directly — not relevant to this plan, but do not introduce it.
- **Module direction**: `core ← greenhouse ← export ← contracts`. `apps.core.permissions` may be imported from `contracts`; the reverse is forbidden. No Django signals.
- **No commits without the user's word.** Each task's commit step is written out, but the executor stages and stops; the user runs the commit unless they said otherwise.
- **i18n**: every new user-visible string gets a key in all three of `frontend/src/i18n/en.json`, `ru.json`, `tk.json`. Never leave one language missing.
- **Backend test command**: `cd backend && python manage.py test <dotted.path> --verbosity=2`
- **Frontend test command**: `cd frontend && npm run test:run -- <path>`
- **Frontend typecheck**: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken, TS5103).
- **Known-red baseline**: the backend suite has 13 pre-existing failures unrelated to this work. Compare against the baseline, do not chase them.
- **Deployment order is load-bearing**: Task 4 (backfill) must be applied before Task 5 (serializer switch) reaches production. Do not reorder.

---

### Task 1: Lock down the sheet-rows admin endpoint

Ships first and alone: it closes a live privilege-escalation hole and changes no Sheet behaviour. Today `SheetRowSettingViewSet` is gated on `shipment.can_edit`, which `document_team`, `transport`, `sales_rep`, `finansist` and `weight_master` all hold — only the hidden page keeps them out. Once triggers become the permission (Task 3), that endpoint would let them grant themselves any cell.

**Files:**
- Modify: `backend/apps/core/permission_registry.py` (RESOURCES tuple, ~line 93; RESOURCE_FIELDS `'shipment'` block, ~line 139)
- Modify: `backend/apps/core/management/commands/seed_permissions.py` (`PAGE_DEFAULTS['export_manager']`, `RESOURCE_DEFAULTS` for admin/director/export_manager)
- Modify: `backend/apps/export/views_sheet_settings.py:274`
- Create: `backend/apps/core/migrations/0038_sheet_row_setting_resource.py`
- Create: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: nothing.
- Produces: resource code `'sheet_row_setting'`, granted view+edit to `admin`, `director`, `export_manager`. Frontend Task 9 gates its tab on `canDo(user, 'sheet_row_setting', 'edit')`.

- [ ] **Step 1: Write the failing test**

Create `backend/apps/export/tests_sheet_authority.py`:

```python
"""Sheet Settings is the permission authority for Sheet-owned fields.

Covers the endpoint lock-down (Task 1), the trigger-only gate (Task 3), the
reverse delegates (Task 2/5) and the write-path parity invariant (Task 5).
"""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.export.models import SheetRowSetting

User = get_user_model()


def _make_user(username: str, role: str) -> 'User':
    return User.objects.create_user(username=username, password='pass', role=role)


class TestSheetRowSettingsEndpointLockdown(TestCase):
    """Only admin / director / export_manager may write Sheet row settings.

    Before this change the ViewSet gated on shipment.can_edit, which five
    non-admin roles hold — the only barrier was frontend page visibility.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.doc = _make_user('lockdown_doc', 'document_team')
        cls.mgr = _make_user('lockdown_mgr', 'export_manager')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
        )

    def setUp(self):
        cache.clear()

    def _patch_as(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client.patch(
            f'/api/v1/export/admin/sheet-rows/{self.row.id}/',
            {'version': self.row.version, 'label_en': 'Destination country'},
            format='json',
        )

    def test_document_team_cannot_patch_sheet_row(self):
        self.assertEqual(self._patch_as(self.doc).status_code, 403)

    def test_export_manager_can_patch_sheet_row(self):
        self.assertEqual(self._patch_as(self.mgr).status_code, 200)
```

Check `SheetRowSetting`'s optimistic-locking field name before running — if the model calls it something other than `version`, use the real name in the payload and in `self.row.version`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestSheetRowSettingsEndpointLockdown --verbosity=2`
Expected: `test_document_team_cannot_patch_sheet_row` FAILS with `200 != 403`.

- [ ] **Step 3: Register the resource**

In `backend/apps/core/permission_registry.py`, add to the `RESOURCES` tuple next to the other shipment entries:

```python
    ('sheet_row_setting',     'Sheet Row Setting (Shipment Settings)'),
```

In the same file, add an entry to `RESOURCE_FIELDS` (resource-level CRUD only — no per-field grants for this resource):

```python
    'sheet_row_setting': [],
```

- [ ] **Step 4: Seed the grants**

In `backend/apps/core/management/commands/seed_permissions.py`, add `'sheet_row_setting': _VCE` to the `RESOURCE_DEFAULTS` blocks for `'admin'`, `'director'` and `'export_manager'` only. Do not add it to any other role — `boss` picks it up from his wildcard comprehension, which is intended.

Add the page to `PAGE_DEFAULTS['export_manager']`:

```python
    'export_manager': {
        # ... existing entries ...
        # Sheet-row access is administered here now (2026-09-02) — Gadam owns
        # the Sheet, so he must be able to grant a row without an admin.
        'admin.shipment_settings',
    } | _UNIVERSAL,
```

- [ ] **Step 5: Point the ViewSet at the new resource**

In `backend/apps/export/views_sheet_settings.py`, change the class attribute and its docstring line:

```python
    # Was 'shipment' — that flag is held by document_team, transport, sales_rep,
    # finansist and weight_master, so the only thing keeping them out of this
    # endpoint was frontend page visibility. Since Sheet row triggers are now
    # the edit permission itself (see docs/ADR.md AD-17), writing here means
    # granting permissions, so it needs its own admin-only resource.
    resource_code = 'sheet_row_setting'
```

- [ ] **Step 6: Write the migration**

Create `backend/apps/core/migrations/0038_sheet_row_setting_resource.py`:

```python
"""Grant the new `sheet_row_setting` resource to admin / director / export_manager.

The Shipment Settings sheet-rows endpoint used to gate on `shipment.can_edit`,
which five non-admin roles hold. Writing a Sheet row trigger now grants an edit
permission (AD-17), so the endpoint moves to its own resource. Also grants
export_manager the Admin: Shipment Settings page so he can administer row access
without an admin account.

Idempotent: get_or_create on the unique keys. Clears the permission cache so
live workers pick the rows up without a restart.
"""
import os

from django.db import migrations


ROLES = ['admin', 'director', 'export_manager']
RESOURCE = 'sheet_row_setting'
PAGE = 'admin.shipment_settings'


def grant(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    for role in ROLES:
        RoleResourcePermission.objects.update_or_create(
            role=role,
            resource_code=RESOURCE,
            defaults={
                'can_view': True,
                'can_create': True,
                'can_edit': True,
                'can_delete': False,
            },
        )
    RolePagePermission.objects.update_or_create(
        role='export_manager',
        page_code=PAGE,
        defaults={'is_visible': True},
    )

    try:
        from django.core.cache import cache
        keys = [f'dynamic_perms:resource:{r}:{RESOURCE}' for r in ROLES]
        keys.append('dynamic_perms:pages:export_manager')
        cache.delete_many(keys)
    except Exception:
        pass


def revoke(apps, schema_editor):
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleResourcePermission.objects.filter(
        role__in=ROLES, resource_code=RESOURCE,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0037_hide_dead_shipment_pages_greenhouse_manager'),
    ]

    operations = [
        migrations.RunPython(grant, reverse_code=revoke),
    ]
```

Confirm `0037_hide_dead_shipment_pages_greenhouse_manager` is still the latest `core` migration before writing the dependency; if a newer one landed, depend on that instead.

- [ ] **Step 7: Apply the migration**

Run: `cd backend && python manage.py migrate core && python manage.py showmigrations core | tail -5`
Expected: `0038_sheet_row_setting_resource` shows `[X]`.

- [ ] **Step 8: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestSheetRowSettingsEndpointLockdown --verbosity=2`
Expected: both tests PASS.

Then the regression check for the settings admin:
Run: `cd backend && python manage.py test apps.export.tests_sheet_settings_admin --verbosity=2`
Expected: PASS. If a test there authenticates as a role that no longer qualifies, update that test to use `export_manager` — the new gate is the intended behaviour.

- [ ] **Step 9: Stage and report**

```bash
git add backend/apps/core/permission_registry.py \
        backend/apps/core/management/commands/seed_permissions.py \
        backend/apps/export/views_sheet_settings.py \
        backend/apps/core/migrations/0038_sheet_row_setting_resource.py \
        backend/apps/export/tests_sheet_authority.py
# Commit message (run only when the user says "commit"):
# fix(core): gate sheet-row settings on its own admin-only resource
```

---

### Task 2: Reverse-delegate map and the batch sheet-gate helper

Pure additions — nothing changes behaviour yet. Several Sheet cells write real columns that have no `field_key` of their own; without this map they would keep falling through to `RoleFieldPermission` after Task 3 and reproduce the original bug.

**Files:**
- Modify: `backend/apps/core/permissions.py` (module constants near `_JUNCTION_FIELD_DELEGATES`, ~line 27-41; new helper after `get_sheet_edit_map`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: `_VIRTUAL_FIELD_DELEGATES`, `_JUNCTION_FIELD_DELEGATES`, `get_sheet_edit_map` (existing).
- Produces:
  - `_REVERSE_FIELD_DELEGATES: dict[str, str]` — real field name → owning Sheet `field_key`.
  - `get_sheet_owned_fields() -> frozenset[str]` — every `DEFAULT_SHEET_ROWS` `field_key` plus every key of `_REVERSE_FIELD_DELEGATES`. A function, not a module constant: `apps.core` must not import `apps.export` at module scope (dependency direction `core ← export`), so the set is built lazily and memoised.
  - `can_edit_sheet_fields(user, field_names: list[str]) -> dict[str, bool]` — one settings query for the whole list, keys are the field names as passed in.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestReverseDelegateMap(TestCase):
    """Composite Sheet cells write real columns that have no field_key.

    box_count is written by the packing cell, truck_head_id by the truck_plate
    cell, and so on. Those real fields must resolve to the owning Sheet row or
    they silently keep answering to RoleFieldPermission.
    """

    def test_every_reverse_target_is_a_real_sheet_row(self):
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        row_keys = {row['field_key'] for row in DEFAULT_SHEET_ROWS}
        for real_field, owning_row in _REVERSE_FIELD_DELEGATES.items():
            self.assertIn(
                owning_row, row_keys,
                f'{real_field} maps to {owning_row}, which is not a Sheet row',
            )

    def test_sheet_owned_fields_covers_rows_and_reverse_keys(self):
        from apps.core.permissions import _REVERSE_FIELD_DELEGATES, get_sheet_owned_fields
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        owned = get_sheet_owned_fields()
        for row in DEFAULT_SHEET_ROWS:
            self.assertIn(row['field_key'], owned)
        for real_field in _REVERSE_FIELD_DELEGATES:
            self.assertIn(real_field, owned)

    def test_batch_helper_agrees_with_the_single_field_gate(self):
        from apps.core.permissions import can_edit_sheet_field, can_edit_sheet_fields

        call_command('seed_permissions')
        cache.clear()
        user = _make_user('batch_probe', 'document_team')
        keys = ['documents_status', 'country', 'import_firm', 'box_count']

        batch = can_edit_sheet_fields(user, keys)
        for key in keys:
            self.assertEqual(
                batch[key], can_edit_sheet_field(user, key),
                f'batch and single-field gate disagree on {key}',
            )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestReverseDelegateMap --verbosity=2`
Expected: FAIL with `ImportError: cannot import name '_REVERSE_FIELD_DELEGATES'`.

- [ ] **Step 3: Add the map and the constant**

In `backend/apps/core/permissions.py`, directly after the `_JUNCTION_FIELD_DELEGATES` block:

```python
# Reverse delegates: real Shipment columns that a composite Sheet cell writes
# but that have no field_key of their own. _VIRTUAL_FIELD_DELEGATES maps a sheet
# key to a real field (for the display gate); this maps a real field back to the
# Sheet row that owns it (for the write gate). Without it those columns keep
# answering to RoleFieldPermission after AD-17 and Shipment Settings is not the
# authority for them — the exact bug this change exists to remove.
#
# Each entry is confirmed against the frontend editor's onCommit payload, not
# guessed from the name:
#   transit_days / transport_temp_c  ← SheetCellEditor, transit_days_temp cell
#   driver_id                        ← SheetDriverSelectEditor, driver_name cell
#   truck_head_id / trailer_id       ← SheetTruckSelectEditor, truck_plate cell
#   vehicle_condition_note           ← SheetCellEditor, vehicle_condition cell
#   packing columns                  ← ShipmentPackingPanel, packing cell
_REVERSE_FIELD_DELEGATES: dict[str, str] = {
    'transit_days': 'transit_days_temp',
    'transport_temp_c': 'transit_days_temp',
    'driver_id': 'driver_name',
    'truck_head_id': 'truck_plate',
    'trailer_id': 'truck_plate',
    'vehicle_condition_note': 'vehicle_condition',
    'box_count': 'packing',
    'pallet_count': 'packing',
    'weight_gross': 'packing',
    'packaging_kg': 'packing',
    'pallet_weight_kg': 'packing',
    'packing_template': 'packing',
}
```

Then, at the bottom of the module (after `get_sheet_edit_map` so `DEFAULT_SHEET_ROWS` is already imported lazily elsewhere), add a lazily-built accessor rather than a module-level import — `apps.core` must not import `apps.export` at module scope:

```python
def get_sheet_owned_fields() -> frozenset[str]:
    """Every field whose edit permission is owned by a Sheet row.

    Lazily built and memoised: apps.core must not import apps.export at module
    import time (dependency direction core ← export).
    """
    global _SHEET_OWNED_FIELDS_CACHE
    if _SHEET_OWNED_FIELDS_CACHE is None:
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        _SHEET_OWNED_FIELDS_CACHE = frozenset(
            {row['field_key'] for row in DEFAULT_SHEET_ROWS}
            | set(_REVERSE_FIELD_DELEGATES)
        )
    return _SHEET_OWNED_FIELDS_CACHE
```

Declare `_SHEET_OWNED_FIELDS_CACHE: frozenset[str] | None = None` next to the other module constants.

- [ ] **Step 4: Add the batch helper**

Append to `backend/apps/core/permissions.py`:

```python
def can_edit_sheet_fields(user, field_names: list[str]) -> dict[str, bool]:
    """Batch form of can_edit_sheet_field for a whole PATCH body.

    Loads the Sheet settings once and answers every field from that one load, so
    a five-field PATCH costs one settings query instead of five. Resolves reverse
    delegates (box_count → packing) before asking the map.

    Args:
        user: The authenticated User instance.
        field_names: Real field names as submitted in the PATCH body.

    Returns:
        {field_name: bool} keyed exactly as passed in.
    """
    if not field_names:
        return {}

    edit_map = get_sheet_edit_map(user)
    owned = get_sheet_owned_fields()

    result: dict[str, bool] = {}
    for name in field_names:
        if name not in owned:
            result[name] = can_edit_field(getattr(user, 'role', None), name)
            continue
        owning_row = _REVERSE_FIELD_DELEGATES.get(name, name)
        result[name] = edit_map.get(owning_row, False)
    return result
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestReverseDelegateMap --verbosity=2`
Expected: all three PASS.

- [ ] **Step 6: Stage and report**

```bash
git add backend/apps/core/permissions.py backend/apps/export/tests_sheet_authority.py
# fix(core): map composite Sheet cells back to their owning row
```

---

### Task 3: Triggers become the grant

The rule change itself. When a Sheet row has trigger config, the trigger alone decides — the `AND can_edit_field` is dropped in both `can_edit_sheet_field` and `get_sheet_edit_map`. This only ever widens access, so it is safe to ship before the backfill.

**Files:**
- Modify: `backend/apps/core/permissions.py:378-388` (`can_edit_sheet_field` rules 5/6) and `:480-490` (`get_sheet_edit_map._resolve`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: Task 2's helpers.
- Produces: the new gate semantics relied on by Tasks 5, 6, 7.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestTriggersAreTheGrant(TestCase):
    """A role named in triggered_roles may edit the cell with no field grant.

    This is the reported bug: document_team was added to the country and
    import_firm rows in Shipment Settings and still could not edit them,
    because FIELD_DEFAULTS['document_team']['shipment'] does not list them.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('trigger_doc', 'document_team')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_no_trigger_and_no_field_grant_denies(self):
        from apps.core.permissions import can_edit_sheet_field
        self.assertFalse(can_edit_sheet_field(self.user, 'country'))

    def test_trigger_alone_grants_without_a_field_permission(self):
        from apps.core.models import RoleFieldPermission
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.models import SheetRowRoleTrigger

        self.assertFalse(
            RoleFieldPermission.objects.filter(
                role='document_team', resource_code='shipment', field_name='country',
            ).exists(),
            'precondition: document_team must NOT hold the country field grant',
        )
        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertTrue(can_edit_sheet_field(self.user, 'country'))

    def test_edit_map_agrees_with_the_single_field_gate(self):
        from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertEqual(
            get_sheet_edit_map(self.user)['country'],
            can_edit_sheet_field(self.user, 'country'),
        )


class TestVirtualRowUsesItsOwnTriggers(TestCase):
    """A virtual row's own trigger config must gate it, not the delegate's.

    `transit_days_temp` (R26) has no column of its own — it writes transit_days
    and transport_temp_c. The delegate check used to run BEFORE the settings
    lookup, so resolving the virtual key recursed straight into `transit_days`,
    which has no SheetRowSetting, and fell through to RoleFieldPermission. The
    row's triggers were unreachable: R26 would have stayed on the old authority
    while every other row moved to Shipment Settings.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='transit_days_temp', row_number=26, display_order=26 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_trigger_on_the_virtual_row_grants_without_a_field_permission(self):
        from apps.core.models import RoleFieldPermission
        from apps.core.permissions import can_edit_sheet_field, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        user = _make_user('virtual_probe', 'document_team')
        self.assertFalse(
            RoleFieldPermission.objects.filter(
                role='document_team', resource_code='shipment',
                field_name='transit_days',
            ).exists(),
            'precondition: document_team must NOT hold the transit_days grant',
        )
        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()

        self.assertTrue(can_edit_sheet_field(user, 'transit_days_temp'))
        self.assertTrue(get_sheet_edit_map(user)['transit_days_temp'])

    def test_virtual_row_without_settings_still_delegates(self):
        """The old behaviour survives where there is no row to consult."""
        from apps.core.permissions import can_edit_sheet_field

        self.row.delete()
        cache.clear()
        transport = _make_user('virtual_transport', 'transport')

        # transport holds the transit_days field grant, so the delegate path
        # must still answer True once the virtual row is gone.
        self.assertTrue(can_edit_sheet_field(transport, 'transit_days_temp'))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestTriggersAreTheGrant --verbosity=2`
Expected: `test_trigger_alone_grants_without_a_field_permission` FAILS — the gate still requires the field grant.

- [ ] **Step 3: Change `can_edit_sheet_field`**

Replace the Rule 5/6 block at the end of `can_edit_sheet_field`:

```python
    # Rule 5/6 (AD-17, 2026-09-02): trigger config IS the permission.
    # Previously this AND-ed _can_edit_sheet_row_field, which meant a grant made
    # in Shipment Settings did nothing until someone also ticked the field in the
    # Permissions admin — two tables, no sync, three regressions in one month.
    # A row with no trigger config at all still falls back to the field perm so
    # rows nobody has configured keep working; a locked row with no config stays
    # closed to everyone but the privileged bypass above.
    if has_any_config:
        return has_any_trigger
    if setting.is_locked:
        return False
    return _can_edit_sheet_row_field(role, field_key)
```

- [ ] **Step 4: Change `get_sheet_edit_map._resolve` identically**

Replace the tail of the inner `_resolve` function:

```python
        # Mirrors can_edit_sheet_field exactly — the two must never disagree.
        if has_any_config:
            return has_any_trigger
        if setting.is_locked:
            return False
        return _has_field_perm(fk)
```

- [ ] **Step 4b: Invert the virtual-delegate ordering in both functions**

Both `can_edit_sheet_field` and `_resolve` currently test `_VIRTUAL_FIELD_DELEGATES` **before** looking up the row's `SheetRowSetting`. That ordering was right under the old model, where `RoleFieldPermission` was the authority — but under this change it makes a virtual row's own triggers unreachable. `transit_days_temp` recurses into `transit_days`, which has no Sheet row, and falls straight through to the field permission. R26 would silently stay on the old authority while every other row moved to Shipment Settings, and `_REVERSE_FIELD_DELEGATES`' `transit_days` / `transport_temp_c` entries would resolve to a row that never gates.

Look the setting up first; delegate only when there is no row to consult. In `can_edit_sheet_field`, delete the early delegate branch and restructure the lookup:

```python
    # Import lazily to avoid circular import
    from apps.export.models import SheetRowSetting

    setting = SheetRowSetting.objects.active().filter(field_key=field_key).prefetch_related(
        'role_triggers', 'user_permissions',
    ).first()

    # Rule 2: no active setting → virtual rows fall back to their real
    # underlying field, everything else to the plain field perm. The delegate
    # check MUST come after this lookup: the row's own triggers are the
    # permission now, so testing the delegate first would make them unreachable.
    if setting is None:
        delegate_key = _VIRTUAL_FIELD_DELEGATES.get(field_key)
        if delegate_key is not None:
            return can_edit_sheet_field(user, delegate_key)
        return _can_edit_sheet_row_field(role, field_key)
```

And the matching head of `_resolve`:

```python
    def _resolve(fk: str) -> bool:
        """Evaluate trigger + field-perm for a single field_key."""
        setting = settings_by_key.get(fk)

        # Delegate only when there is no row of our own — see the note in
        # can_edit_sheet_field; the two orderings must stay identical.
        if setting is None:
            delegate_key = _VIRTUAL_FIELD_DELEGATES.get(fk)
            if delegate_key is not None:
                return _resolve(delegate_key)
            return _has_field_perm(fk)
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority --verbosity=2`
Expected: PASS.

Then the existing sheet-permission suites:
Run: `cd backend && python manage.py test apps.export.tests_sheet_perms apps.export.tests_shipment_sheet --verbosity=2`
Expected: PASS. Two tests in `tests_sheet_perms` assert the old AND semantics by name — the docstring at `tests_sheet_perms.py:156` ("role_triggers matches but RoleFieldPermission denies → False") is now wrong by design. Rewrite those two to assert the new rule and note AD-17 in the docstring. Do NOT loosen `TestEveryRoleCanEditItsOwnSheetRow` — it must still pass unchanged.

- [ ] **Step 6: Stage and report**

```bash
git add backend/apps/core/permissions.py \
        backend/apps/export/tests_sheet_authority.py \
        backend/apps/export/tests_sheet_perms.py
# feat(core): make Sheet row triggers the edit permission (AD-17)
```

---

### Task 4: Backfill triggers from today's field grants

Must be applied before Task 5 reaches production. Task 5 switches the write gate to the sheet gate; any role that edits today purely through `RoleFieldPermission` and is absent from a row's triggers would lose write access. `has_any_config` is evaluated per row, not per role — so a wildcard holder like `boss` is denied the moment any other role gets a trigger on that row.

**Files:**
- Create: `backend/apps/export/migrations/00NN_backfill_sheet_row_triggers.py` (use the next free number in `backend/apps/export/migrations/`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: `_REVERSE_FIELD_DELEGATES`, `_JUNCTION_FIELD_DELEGATES` (Task 2).
- Produces: every row's `triggered_roles` is a superset of the roles that could edit it before.

**Note on test setup:** `seed_permissions` has no `DJANGO_TESTING` guard (verified 2026-09-02), so `call_command('seed_permissions')` really does populate `RoleFieldPermission` inside tests and `backfill()` has grants to mirror. The *migration* is guarded, which is why the tests below call `backfill()` directly instead of relying on `migrate`.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestBackfillPreservesEveryRolesAccess(TestCase):
    """Nobody loses write access when the serializer switches to the sheet gate.

    Snapshots the pre-migration verdict for every (role, sheet field) pair using
    the OLD authority (RoleFieldPermission), runs the backfill, then asserts the
    NEW authority (the sheet gate) says yes wherever the old one did.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')

    def setUp(self):
        cache.clear()

    def test_wildcard_roles_are_expanded_across_every_row(self):
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )
        backfill()
        cache.clear()

        # boss holds shipment: ['*'] but is NOT in the privileged bypass set,
        # so without expansion he loses every cell the moment any other role
        # gets a trigger on it.
        boss = _make_user('backfill_boss', 'boss')
        from apps.core.permissions import get_sheet_edit_map
        edit_map = get_sheet_edit_map(boss)
        denied = [key for key, allowed in edit_map.items() if not allowed]
        self.assertEqual(denied, [], f'boss lost access to: {denied}')

    def test_every_owning_role_can_still_edit_its_row_with_settings_present(self):
        """The settings-present twin of TestEveryRoleCanEditItsOwnSheetRow.

        That sweep deletes every SheetRowSetting in its own setUp, so it only
        ever exercises the `setting is None` fallback. Once this backfill seeds
        triggers on every row, `has_any_config` is True everywhere in
        production and that fallback becomes dead code — the old sweep would
        keep passing while measuring a path production no longer takes. This
        one provisions every row, runs the backfill, and then asserts the same
        property the old sweep asserts, against the branch that now runs.
        """
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_defaults import WHO_TO_ROLE
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )
        backfill()

        failures = []
        for row in DEFAULT_SHEET_ROWS:
            who_key = row.get('default_who_key')
            if not who_key:
                continue
            owner = who_key.rsplit('.', 1)[-1]
            for role in WHO_TO_ROLE.get(owner, []):
                cache.clear()
                user = _make_user(f'sweep_{role}_{row["row_number"]}', role)
                if not can_edit_sheet_field(user, row['field_key']):
                    failures.append(f"{role} lost {row['field_key']} (R{row['row_number']})")

        self.assertEqual(failures, [], '\n'.join(failures))

    def test_document_team_keeps_its_junction_wildcard(self):
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        from apps.export.models import SheetRowSetting

        SheetRowSetting.objects.create(
            field_key='firm_splits', row_number=9, display_order=9 * 1024,
        )
        backfill()
        cache.clear()

        doc = _make_user('backfill_doc', 'document_team')
        self.assertTrue(can_edit_sheet_field(doc, 'firm_splits'))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestBackfillPreservesEveryRolesAccess --verbosity=2`
Expected: FAIL with `ModuleNotFoundError: ... backfill_sheet_row_triggers`.

- [ ] **Step 3: Write the backfill as a management command**

Create `backend/apps/export/management/commands/backfill_sheet_row_triggers.py`. A command (not migration-only logic) so it can be re-run on beta and production after any `seed_permissions --reset`:

```python
"""Copy today's RoleFieldPermission grants into SheetRowSetting.role_triggers.

Sheet row triggers became the edit permission on 2026-09-02 (AD-17). Any role
that could edit a cell only through RoleFieldPermission would lose write access
once ShipmentPatchSerializer switches to the sheet gate, so every such grant is
mirrored into triggered_roles first.

Two rules that are easy to get wrong:
  - A '*' field grant expands to EVERY sheet row for that role. has_any_config
    is per row, so a wildcard role absent from one row's triggers is denied on
    that row as soon as any other role is added to it.
  - Junction rows read their own resource_code (shipment_firm_split /
    shipment_block_source), never 'shipment'.

Idempotent: get_or_create on (row, role). Safe to re-run.
"""
from django.core.management.base import BaseCommand
from django.db import transaction


def backfill() -> int:
    """Mirror field grants into row triggers. Returns the number of rows added."""
    from apps.core.models import RoleFieldPermission
    from apps.core.permissions import _JUNCTION_FIELD_DELEGATES, _REVERSE_FIELD_DELEGATES
    from apps.export.models import SheetRowRoleTrigger, SheetRowSetting

    settings_by_key = {s.field_key: s for s in SheetRowSetting.objects.active()}

    # field_key → (resource_code, field_name) for the junction rows, so we ask
    # the same table the gate asks.
    junction_lookup = {
        field_key: (resource, field)
        for field_key, (resource, field) in _JUNCTION_FIELD_DELEGATES.items()
    }

    grants: dict[str, set[str]] = {}
    for role, resource_code, field_name in RoleFieldPermission.objects.values_list(
        'role', 'resource_code', 'field_name',
    ):
        grants.setdefault(f'{resource_code}:{field_name}', set()).add(role)

    wildcard_roles = grants.get('shipment:*', set())

    added = 0
    with transaction.atomic():
        for field_key, setting in settings_by_key.items():
            roles: set[str] = set(wildcard_roles)

            if field_key in junction_lookup:
                resource_code, field_name = junction_lookup[field_key]
                roles |= grants.get(f'{resource_code}:{field_name}', set())
                roles |= grants.get(f'{resource_code}:*', set())
            else:
                roles |= grants.get(f'shipment:{field_key}', set())

            # A reverse-delegated row inherits the grants of every real column
            # it writes (packing ← box_count, pallet_count, weight_gross, ...).
            for real_field, owning_row in _REVERSE_FIELD_DELEGATES.items():
                if owning_row == field_key:
                    roles |= grants.get(f'shipment:{real_field}', set())

            for role in roles:
                _, created = SheetRowRoleTrigger.objects.get_or_create(
                    row=setting, role=role,
                )
                added += int(created)
    return added


class Command(BaseCommand):
    help = 'Mirror RoleFieldPermission grants into SheetRowSetting role triggers (AD-17).'

    def handle(self, *args, **options):
        added = backfill()
        self.stdout.write(self.style.SUCCESS(f'Added {added} role triggers.'))
```

- [ ] **Step 4: Wrap it in a migration**

Create `backend/apps/export/migrations/00NN_backfill_sheet_row_triggers.py` (next free number):

```python
"""Run the AD-17 trigger backfill so no role loses write access.

See apps/export/management/commands/backfill_sheet_row_triggers.py for the
rules. Skipped under DJANGO_TESTING like the other permission data migrations —
tests call backfill() directly against seeded data.
"""
import os

from django.db import migrations


def run_backfill(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    from apps.export.management.commands.backfill_sheet_row_triggers import backfill
    backfill()


def noop_reverse(apps, schema_editor):
    """Not reversed: we cannot tell a backfilled trigger from a hand-made one."""


class Migration(migrations.Migration):

    dependencies = [
        # Replace with the current latest export migration.
        ('export', '00NN_previous'),
    ]

    operations = [
        migrations.RunPython(run_backfill, reverse_code=noop_reverse),
    ]
```

Run `ls backend/apps/export/migrations/ | tail -5` to find the real latest migration and fill both the filename number and the dependency.

- [ ] **Step 5: Apply and verify on the dev DB**

Run: `cd backend && python manage.py migrate export && python manage.py backfill_sheet_row_triggers`
Expected: the second run reports `Added 0 role triggers.` — proving idempotency.

- [ ] **Step 6: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority --verbosity=2`
Expected: PASS.

- [ ] **Step 7: Stage and report**

```bash
git add backend/apps/export/management/commands/backfill_sheet_row_triggers.py \
        backend/apps/export/migrations/00NN_backfill_sheet_row_triggers.py \
        backend/apps/export/tests_sheet_authority.py
# data(p3): backfill Sheet row triggers from field grants (AD-17)
```

---

### Task 5: Switch the write gate and assert parity

The hole that made the reported bug invisible: `PATCH /shipments/{id}/` validates through `can_edit_field` and never reads `role_triggers`, so Shipment Settings never controlled the actual write.

**Files:**
- Modify: `backend/apps/export/serializers.py:1540-1556` (`ShipmentPatchSerializer.validate`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: `can_edit_sheet_fields`, `get_sheet_owned_fields` (Task 2); the new gate (Task 3); the backfill (Task 4).
- Produces: write verdicts identical to `get_sheet_edit_map` for every visible Sheet row.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestWritePathParity(TestCase):
    """The write gate and the display map must give the same answer.

    Scoped to VISIBLE rows: hidden rows are expected to disagree by design
    (the write gate ignores is_visible — visibility is presentation, not
    permission), which TestHiddenRowStillWritable covers separately.

    Delegated fields have no key of their own in the edit map (it iterates
    DEFAULT_SHEET_ROWS), so the comparison pairs the real field against its
    owning row: serializer('box_count') vs edit_map('packing').
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        from apps.export.models import SheetRowSetting
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

        SheetRowSetting.objects.bulk_create(
            [
                SheetRowSetting(
                    field_key=row['field_key'],
                    row_number=row['row_number'],
                    display_order=row['row_number'] * 1024,
                )
                for row in DEFAULT_SHEET_ROWS
            ],
            batch_size=500,
        )
        from apps.export.management.commands.backfill_sheet_row_triggers import backfill
        backfill()

    def setUp(self):
        cache.clear()

    def test_the_two_bypass_lists_still_agree(self):
        """The serializer short-circuits on PRIVILEGED_ROLES; the sheet gate
        bypasses on a literal tuple. They match today. If either is edited
        without the other, the two gates split apart again — which is the exact
        data/code drift AD-17 exists to kill. Fail loudly instead."""
        from apps.core.roles import PRIVILEGED_ROLES
        self.assertEqual(
            set(PRIVILEGED_ROLES), {'admin', 'director', 'export_manager'},
            'PRIVILEGED_ROLES changed — update can_edit_sheet_field and '
            'get_sheet_edit_map bypass tuples to match, then update this test.',
        )

    def test_serializer_verdict_matches_edit_map_for_every_role_and_field(self):
        from apps.core.permissions import (
            _REVERSE_FIELD_DELEGATES,
            can_edit_sheet_fields,
            get_sheet_edit_map,
        )
        from apps.core.roles import PRIVILEGED_ROLES
        from apps.export.models import SheetRowSetting

        visible = set(
            SheetRowSetting.objects.active()
            .filter(is_visible=True)
            .values_list('field_key', flat=True)
        )
        roles = ['document_team', 'transport', 'loading_dept_head', 'sales_rep',
                 'finansist', 'weight_master', 'boss']

        for role in roles:
            if role in PRIVILEGED_ROLES:
                continue
            user = _make_user(f'parity_{role}', role)
            cache.clear()
            edit_map = get_sheet_edit_map(user)

            probe = sorted(visible | set(_REVERSE_FIELD_DELEGATES))
            verdicts = can_edit_sheet_fields(user, probe)

            for field in probe:
                owning_row = _REVERSE_FIELD_DELEGATES.get(field, field)
                if owning_row not in visible:
                    continue
                self.assertEqual(
                    verdicts[field], edit_map[owning_row],
                    f'{role}: write gate and display map disagree on '
                    f'{field} (row {owning_row})',
                )


class TestHiddenRowStillWritable(TestCase):
    """Decision A: is_visible is presentation, not permission.

    Hiding a Sheet row removes the column; it must not revoke edit rights on the
    detail page or the edit drawer.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='country', row_number=11, display_order=11 * 1024,
            is_visible=False,
        )

    def setUp(self):
        cache.clear()

    def test_hidden_row_is_not_editable_on_the_sheet_but_is_writable(self):
        from apps.core.permissions import can_edit_sheet_fields, get_sheet_edit_map
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='document_team')
        cache.clear()
        user = _make_user('hidden_probe', 'document_team')

        self.assertFalse(get_sheet_edit_map(user)['country'])
        self.assertTrue(can_edit_sheet_fields(user, ['country'])['country'])
```

`can_edit_sheet_fields` as written in Task 2 reads `get_sheet_edit_map`, which honours `is_visible` — so `TestHiddenRowStillWritable` fails until Step 3 adds the `ignore_visibility` path. That is intended: write the test first, then make it pass.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestWritePathParity apps.export.tests_sheet_authority.TestHiddenRowStillWritable --verbosity=2`
Expected: `TestHiddenRowStillWritable` FAILS on the second assertion.

- [ ] **Step 3: Add the visibility-ignoring write path**

In `backend/apps/core/permissions.py`, give `get_sheet_edit_map` an `ignore_visibility` flag and thread it into `_resolve`:

```python
def get_sheet_edit_map(user, settings_by_key: dict | None = None,
                       ignore_visibility: bool = False) -> dict[str, bool]:
```

and inside `_resolve`, replace the visibility guard:

```python
        # Decision A (AD-17): visibility is presentation, not permission. The
        # display map hides the column; the write path (serializer, drawer,
        # detail page) must not lose the grant because a column was hidden.
        if not setting.is_visible and not ignore_visibility:
            return False
```

Then have `can_edit_sheet_fields` pass `ignore_visibility=True`:

```python
    edit_map = get_sheet_edit_map(user, ignore_visibility=True)
```

- [ ] **Step 4: Switch the serializer**

In `backend/apps/export/serializers.py`, replace the `validate` body of `ShipmentPatchSerializer`:

```python
    def validate(self, attrs: dict) -> dict:
        role = self.context.get('role')
        if role in PRIVILEGED_ROLES:
            return attrs

        request = self.context.get('request')
        user = getattr(request, 'user', None)

        # column_color is a UI tint, not domain data — open to every Sheet
        # viewer regardless of their per-field grants on shipment.
        candidates = [f for f in attrs if f != 'column_color']

        # AD-17: for Sheet-owned fields the row's trigger config is the
        # permission, so the write gate and the Sheet's own edit map are the
        # same function. Fields with no Sheet row still answer to
        # RoleFieldPermission. One settings load covers the whole body.
        if user is not None:
            verdicts = can_edit_sheet_fields(user, candidates)
        else:
            verdicts = {f: can_edit_field(role, f) for f in candidates}

        forbidden = [f for f in candidates if not verdicts.get(f, False)]
        if forbidden:
            raise serializers.ValidationError(
                {f: f"Role '{role}' cannot edit this field." for f in forbidden}
            )
        return attrs
```

Add `can_edit_sheet_fields` to the existing import at `serializers.py:7`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority --verbosity=2`
Expected: PASS.

Then the shipment PATCH suites:
Run: `cd backend && python manage.py test apps.export.tests apps.export.tests_sheet_perms apps.export.tests_shipment_sheet --verbosity=2`
Expected: PASS, or the same failures as the 13-failure baseline. Any NEW failure here is a real regression — root-cause it, do not loosen the assertion.

- [ ] **Step 6: Add the query-count guard**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
    def test_multi_field_patch_loads_settings_once(self):
        """A five-field PATCH must not cost five settings queries."""
        from apps.core.permissions import can_edit_sheet_fields

        user = _make_user('qcount_probe', 'document_team')
        cache.clear()
        fields = ['country', 'import_firm', 'customer', 'city', 'documents_status']
        with self.assertNumQueries(4):
            can_edit_sheet_fields(user, fields)
```

Run it; if the real count differs, set the assertion to the observed number and add a comment explaining what the queries are — the point is that it does not scale with the field count. Verify that by re-running with a two-field list and confirming the same count.

- [ ] **Step 7: Stage and report**

```bash
git add backend/apps/core/permissions.py \
        backend/apps/export/serializers.py \
        backend/apps/export/tests_sheet_authority.py
# feat(p3): route shipment PATCH through the Sheet permission gate (AD-17)
```

---

### Task 6: Bring the remaining write endpoints onto the same gate

Three write paths still answer to a different table. Leaving any of them split reproduces the bug in a new place: the user ticks a row for a role and that role still gets a 403 from one of these.

**Files:**
- Modify: `backend/apps/core/permissions.py` (new `sheet_field_write_permission` factory next to `junction_write_permission`, ~line 634)
- Modify: `backend/apps/export/views.py` (`get_permissions` branches for `set_firm_splits` / `set_block_sources`; the bulk-op loop near line 2604)
- Modify: `backend/apps/contracts/` — the `shipment-packing` view (find with `grep -rn "shipment-packing" backend/apps/contracts/`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: `can_edit_sheet_field` (Task 3).
- Produces: `sheet_field_write_permission(field_key: str) -> type` — a DRF permission class factory gating an action on one Sheet row.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestPackingEndpointFollowsTheSheetRow(TestCase):
    """Decision C: packing goes in whole, not half.

    box_count reaches the DB two ways — PATCH /shipments/{id}/ and
    POST /contracts/shipment-packing/. If only the first follows the packing
    row, ticking `packing` for a role still 403s from ShipmentPackingPanel.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.row = SheetRowSetting.objects.create(
            field_key='packing', row_number=48, display_order=48 * 1024,
        )

    def setUp(self):
        cache.clear()

    def test_role_without_the_packing_trigger_is_refused(self):
        from apps.export.models import SheetRowRoleTrigger

        SheetRowRoleTrigger.objects.create(row=self.row, role='transport')
        cache.clear()
        doc = _make_user('packing_doc', 'document_team')

        client = APIClient()
        client.force_authenticate(user=doc)
        response = client.post(
            '/api/v1/contracts/shipment-packing/',
            {'shipment': 1, 'scope': 'template', 'packing_template': 1},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
```

Adjust the URL prefix if `grep -rn "shipment-packing" backend/apps/contracts/urls.py` shows a different mount point.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestPackingEndpointFollowsTheSheetRow --verbosity=2`
Expected: FAIL — a status other than 403 (400 or 404 from the view body means the permission let the request through).

- [ ] **Step 3: Add the permission factory**

In `backend/apps/core/permissions.py`, after `junction_write_permission`:

```python
def sheet_field_write_permission(field_key: str) -> type:
    """DRF permission for an action that writes one Sheet row's data.

    Since AD-17 the row's trigger config IS the edit permission, so an endpoint
    that writes a Sheet-owned field must ask the same gate the Sheet asks —
    otherwise the same field has two different answers depending on which UI
    saved it, which is the divergence AD-17 exists to remove.

    Usage in get_permissions():
        if action == 'set_firm_splits':
            return [IsAuthenticated(), SeasonNotClosed(),
                    sheet_field_write_permission('firm_splits')()]
    """

    class _SheetFieldWritePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            # can_edit_sheet_fields, not can_edit_sheet_field: this is a WRITE
            # path, and Decision A says visibility is presentation, not
            # permission. Using the visibility-honouring gate here would 403 a
            # junction write on a hidden row while the equivalent shipment PATCH
            # still succeeded — one field, two answers.
            return can_edit_sheet_fields(request.user, [field_key])[field_key]

    return _SheetFieldWritePermission
```

- [ ] **Step 4: Point the call sites at it**

In `backend/apps/export/views.py`, in `get_permissions`, replace the junction branches:

```python
        if action == 'set_firm_splits':
            # AD-17: the firm_splits Sheet row is the authority now, not the
            # shipment_firm_split resource flag.
            return [IsAuthenticated(), SeasonNotClosed(),
                    sheet_field_write_permission('firm_splits')()]
        if action == 'set_block_sources':
            return [IsAuthenticated(), SeasonNotClosed(),
                    sheet_field_write_permission('block_sources')()]
```

Import `sheet_field_write_permission` alongside the existing `can_edit_sheet_field` import at `views.py:32`. Keep whatever the current action names are — confirm with `grep -n "set_firm_splits\|set_block_sources" backend/apps/export/views.py`.

In the contracts packing view, add the same class to `permission_classes` or `get_permissions`:

```python
    permission_classes = [IsAuthenticated, sheet_field_write_permission('packing')]
```

`apps.contracts` importing `apps.core.permissions` is allowed (`core ← … ← contracts`).

Finally, the custom-fields PATCH at `views.py:2897` is a WRITE that still calls
`can_edit_sheet_field`, which honours `is_visible`. Under Decision A a write
path must not: hiding a custom row would 403 its PATCH while an equivalent
shipment PATCH of a hidden field succeeded — one field, two answers, which is
the divergence AD-17 removes. Switch the verdict source only, keeping the
existing error message and status code exactly as they are:

```python
        if not can_edit_sheet_fields(request.user, [field_key])[field_key]:
```

Once this and the swap loop are converted, every remaining
`can_edit_sheet_field` caller is a read or display path, where honouring
visibility is correct. Confirm that with
`grep -n "can_edit_sheet_field(" backend/apps/export/views.py` and state the
remaining callers in your report.

- [ ] **Step 5: Thread one settings load through the swap loop**

The per-field gate at `backend/apps/export/views.py:2598-2612` is the `swap` action's pre-check: a fail-fast loop over `requested_fields` that returns 403 on the first field the user cannot edit. Keep that behaviour and that exact error string — existing tests assert on it. Only the source of the verdict changes, so the loop stops re-querying `SheetRowSetting` once per field:

```python
        # --- Whitelist + permission gate (cheap pre-checks on unlocked rows) ---
        # One settings load for the whole swap — can_edit_sheet_field re-queries
        # SheetRowSetting per call, and a swap can carry a dozen fields.
        verdicts = can_edit_sheet_fields(request.user, list(requested_fields))
        for field in requested_fields:
            if field not in SWAPPABLE_FIELDS:
                return Response(
                    {'error': f"Field '{field}' is not swappable"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not verdicts.get(field, False):
                return Response(
                    {
                        'error': (
                            f"You don't have permission to edit field '{field}' on this shipment"
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
```

Before editing, run `grep -n "can_edit_sheet_field" backend/apps/export/views.py` and confirm this is still the only per-field loop left — if another one appeared, give it the same treatment.

- [ ] **Step 6: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority --verbosity=2`
Expected: PASS.

Run: `cd backend && python manage.py test apps.export apps.contracts --verbosity=1`
Expected: same failures as the baseline, no new ones.

- [ ] **Step 7: Stage and report**

```bash
git add backend/apps/core/permissions.py backend/apps/export/views.py \
        backend/apps/contracts/ backend/apps/export/tests_sheet_authority.py
# feat(p3): gate junction, bulk and packing writes on the Sheet row (AD-17)
```

---

### Task 7: Role-first bulk endpoint

The new UI edits one role across all rows. Doing that with 45 individual PATCHes would be slow and non-atomic.

**Files:**
- Modify: `backend/apps/export/views_sheet_settings.py` (new `@action` on `SheetRowSettingViewSet`)
- Test: `backend/apps/export/tests_sheet_authority.py`

**Interfaces:**
- Consumes: the `sheet_row_setting` resource (Task 1).
- Produces: `POST /api/v1/export/admin/sheet-rows/role-access/` accepting `{"role": str, "field_keys": [str]}`, returning `{"role": str, "added": int, "removed": int}`. Frontend Task 8 calls this.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/export/tests_sheet_authority.py`:

```python
class TestRoleAccessBulkEndpoint(TestCase):
    """One request sets a role's access across every Sheet row."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.mgr = _make_user('roleaccess_mgr', 'export_manager')
        cls.doc = _make_user('roleaccess_doc', 'document_team')
        for key, number in (('country', 11), ('import_firm', 14), ('city', 13)):
            SheetRowSetting.objects.create(
                field_key=key, row_number=number, display_order=number * 1024,
            )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _post(self, user, payload):
        self.client.force_authenticate(user=user)
        return self.client.post(
            '/api/v1/export/admin/sheet-rows/role-access/', payload, format='json',
        )

    def test_replaces_the_roles_triggers_across_all_rows(self):
        from apps.export.models import SheetRowRoleTrigger

        response = self._post(self.mgr, {
            'role': 'document_team',
            'field_keys': ['country', 'import_firm'],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(
                SheetRowRoleTrigger.objects
                .filter(role='document_team')
                .values_list('row__field_key', flat=True)
            ),
            {'country', 'import_firm'},
        )

        # A second call with a different set REPLACES, never merges.
        self._post(self.mgr, {'role': 'document_team', 'field_keys': ['city']})
        self.assertEqual(
            set(
                SheetRowRoleTrigger.objects
                .filter(role='document_team')
                .values_list('row__field_key', flat=True)
            ),
            {'city'},
        )

    def test_non_admin_role_is_refused(self):
        response = self._post(self.doc, {'role': 'document_team', 'field_keys': []})
        self.assertEqual(response.status_code, 403)

    def test_unknown_field_key_is_rejected(self):
        response = self._post(self.mgr, {
            'role': 'document_team', 'field_keys': ['not_a_row'],
        })
        self.assertEqual(response.status_code, 400)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestRoleAccessBulkEndpoint --verbosity=2`
Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Implement the action**

Add to `SheetRowSettingViewSet` in `backend/apps/export/views_sheet_settings.py`:

```python
    @action(detail=False, methods=['post'], url_path='role-access')
    def role_access(self, request):
        """POST /api/v1/export/admin/sheet-rows/role-access/

        Set one role's edit access across every Sheet row in one transaction.
        The Row access tab in Shipment Settings is the only writer.

        Body:
            { "role": "document_team", "field_keys": ["country", "import_firm"] }

        Replaces — the role's triggers on rows absent from field_keys are
        removed. Writes one AuditLog row per changed Sheet row, matching the
        `triggered_roles` shape written by _perform_update_with_audit.

        Returns:
            { "role": str, "added": int, "removed": int }

        Errors:
            400 if role is missing/unknown or any field_key has no active row.
        """
        role = (request.data.get('role') or '').strip()
        valid_roles = {choice[0] for choice in ROLE_CHOICES}
        if role not in valid_roles:
            return Response(
                {'error': f"Unknown role '{role}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        field_keys = request.data.get('field_keys')
        if not isinstance(field_keys, list):
            return Response(
                {'error': 'field_keys must be a list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rows_by_key = {
            r.field_key: r for r in SheetRowSetting.objects.active()
        }
        unknown = [k for k in field_keys if k not in rows_by_key]
        if unknown:
            return Response(
                {'error': f"Unknown field_keys: {', '.join(sorted(unknown))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        wanted = {rows_by_key[k].id for k in field_keys}
        existing = set(
            SheetRowRoleTrigger.objects
            .filter(role=role, row__in=rows_by_key.values())
            .values_list('row_id', flat=True)
        )
        to_add = wanted - existing
        to_remove = existing - wanted

        id_to_key = {r.id: r.field_key for r in rows_by_key.values()}

        with transaction.atomic():
            SheetRowRoleTrigger.objects.filter(
                role=role, row_id__in=to_remove,
            ).delete()
            SheetRowRoleTrigger.objects.bulk_create(
                [SheetRowRoleTrigger(row_id=rid, role=role) for rid in to_add],
                batch_size=500,
            )
            AuditLog.objects.bulk_create(
                [
                    AuditLog(
                        user=request.user,
                        action='update',
                        model_name='SheetRowSetting',
                        object_id=rid,
                        object_repr=id_to_key[rid],
                        field_name='triggered_roles',
                        old_value='' if rid in to_add else role,
                        new_value=role if rid in to_add else '',
                        detail=(
                            f"role-access: {'+' if rid in to_add else '-'}{role} "
                            f"on {id_to_key[rid]}"
                        ),
                    )
                    for rid in (to_add | to_remove)
                ],
                batch_size=500,
            )

        # Trigger rows are read live, but the role's resource/page caches are not.
        cache.delete(f'{PERM_CACHE_PREFIX}:all_fields:{role}')

        return Response({
            'role': role,
            'added': len(to_add),
            'removed': len(to_remove),
        })
```

Add whatever of `action`, `Response`, `status`, `transaction`, `cache`, `ROLE_CHOICES`, `SheetRowRoleTrigger`, `AuditLog`, `PERM_CACHE_PREFIX` is not already imported at the top of the file.

- [ ] **Step 4: Run the tests**

Run: `cd backend && python manage.py test apps.export.tests_sheet_authority.TestRoleAccessBulkEndpoint --verbosity=2`
Expected: all three PASS.

- [ ] **Step 5: Stage and report**

```bash
git add backend/apps/export/views_sheet_settings.py backend/apps/export/tests_sheet_authority.py
# feat(p3): add role-first bulk endpoint for Sheet row access
```

---

### Task 8: Frontend hook and types

**Files:**
- Modify: `frontend/src/hooks/useSheetRowSettings.ts`
- Modify: `frontend/src/types/index.ts` (near `ISheetRowSetting`, ~line 600)
- Test: `frontend/src/hooks/useSheetRowAccess.test.tsx` (create)

**Interfaces:**
- Consumes: `POST /export/admin/sheet-rows/role-access/` (Task 7).
- Produces:
  - `ISaveRoleAccessPayload { role: string; field_keys: string[] }`
  - `useSaveRoleAccess()` — TanStack mutation returning `{ role: string; added: number; removed: number }`, invalidating `['admin', 'sheet-rows']` on success.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useSheetRowAccess.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import api from '@/services/api';
import { useSaveRoleAccess } from './useSheetRowSettings';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSaveRoleAccess', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('posts the role and its field keys to role-access/', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { role: 'document_team', added: 2, removed: 0 },
    });

    const { result } = renderHook(() => useSaveRoleAccess(), { wrapper });
    result.current.mutate({ role: 'document_team', field_keys: ['country', 'import_firm'] });

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/export/admin/sheet-rows/role-access/',
      { role: 'document_team', field_keys: ['country', 'import_firm'] },
    ));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:run -- src/hooks/useSheetRowAccess.test.tsx`
Expected: FAIL — `useSaveRoleAccess` is not exported.

- [ ] **Step 3: Add the hook**

Append to `frontend/src/hooks/useSheetRowSettings.ts`:

```typescript
// ─── Role-first access (AD-17) ────────────────────────────────────────────────

export interface ISaveRoleAccessPayload {
  role: string;
  /** Full replacement set — rows absent here lose this role's trigger. */
  field_keys: string[];
}

export interface IRoleAccessResult {
  role: string;
  added: number;
  removed: number;
}

/** Set one role's edit access across every Sheet row in one request. */
export function useSaveRoleAccess() {
  const queryClient = useQueryClient();
  return useMutation<IRoleAccessResult, AxiosError<{ error: string }>, ISaveRoleAccessPayload>({
    mutationFn: async (payload): Promise<IRoleAccessResult> => {
      const { data } = await api.post<IRoleAccessResult>(
        '/export/admin/sheet-rows/role-access/',
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:run -- src/hooks/useSheetRowAccess.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and stage**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no new errors.

```bash
git add frontend/src/hooks/useSheetRowSettings.ts frontend/src/hooks/useSheetRowAccess.test.tsx
# feat(frontend): add role-access mutation for Sheet row permissions
```

---

### Task 9: The Row access tab

**Files:**
- Create: `frontend/src/pages/admin/shipment-settings/RowAccessTab.tsx`
- Create: `frontend/src/pages/admin/shipment-settings/RowAccessTab.test.tsx`
- Modify: `frontend/src/pages/admin/ShipmentSettingsPage.tsx`
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json`

**Interfaces:**
- Consumes: `useSheetRowSettings`, `useSaveRoleAccess` (Task 8); `RoleSidebar` from `@/pages/admin/permissions/RoleSidebar`; `ROLE_CHOICES` (same constant `SheetRowsTab.tsx:49` uses).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/shipment-settings/RowAccessTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import api from '@/services/api';
import RowAccessTab from './RowAccessTab';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const ROWS = [
  { id: 1, field_key: 'country', row_number: 11, display_order: 11264,
    label_en: 'Destination country', is_visible: true, triggered_roles: ['export_manager'] },
  { id: 2, field_key: 'import_firm', row_number: 14, display_order: 14336,
    label_en: 'Import firm', is_visible: true, triggered_roles: [] },
];

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><RowAccessTab canWrite /></QueryClientProvider>,
  );
}

describe('RowAccessTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: ROWS });
    vi.mocked(api.post).mockResolvedValue({ data: { role: 'document_team', added: 1, removed: 0 } });
  });

  it('lists every Sheet row for the selected role', async () => {
    renderTab();
    expect(await screen.findByText('country')).toBeInTheDocument();
    expect(screen.getByText('import_firm')).toBeInTheDocument();
  });

  it('saves the ticked rows for the selected role', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('document_team'));
    fireEvent.click(await screen.findByLabelText('import_firm'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/export/admin/sheet-rows/role-access/',
      { role: 'document_team', field_keys: ['import_firm'] },
    ));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:run -- src/pages/admin/shipment-settings/RowAccessTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the tab**

Create `frontend/src/pages/admin/shipment-settings/RowAccessTab.tsx`. Keep it under 150 lines; if the checkbox list grows past that, extract a `row-access/RowAccessList.tsx`.

```tsx
import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Flex, Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { RoleSidebar } from '@/pages/admin/permissions/RoleSidebar';
import { useSheetRowSettings, useSaveRoleAccess } from '@/hooks/useSheetRowSettings';
import { ROLE_CHOICES } from '@/constants/roles';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IRowAccessTabProps {
  canWrite: boolean;
}

/**
 * The one place row access is granted (AD-17). Pick a role, tick the rows it may
 * edit. Ticking writes SheetRowSetting.role_triggers, which IS the edit
 * permission — the Sheet rows tab shows the same data read-only.
 */
export default function RowAccessTab({ canWrite }: IRowAccessTabProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useSheetRowSettings();
  const save = useSaveRoleAccess();

  const roles = useMemo(() => ROLE_CHOICES.map((r) => r.value), []);
  const [role, setRole] = useState<string>(roles[0]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string> | null>(null);

  const saved = useMemo(
    () => new Set(rows.filter((r) => r.triggered_roles.includes(role)).map((r) => r.field_key)),
    [rows, role],
  );
  const current = draft ?? saved;
  const isDirty = draft !== null;

  const visible = rows.filter(
    (r) => !search || r.field_key.includes(search) || (r.label_en ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (fieldKey: string, checked: boolean) => {
    const next = new Set(current);
    if (checked) next.add(fieldKey);
    else next.delete(fieldKey);
    setDraft(next);
  };

  const selectRole = (next: string) => {
    setRole(next);
    setDraft(null);
  };

  const commit = () => {
    save.mutate(
      { role, field_keys: [...current].sort() },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <Flex gap={16} align="flex-start">
      <RoleSidebar roles={roles} selected={role} onSelect={selectRole} />

      <Flex vertical gap={12} style={{ flex: 1 }}>
        <Alert type="info" showIcon message={t('row_access.hint')} />

        <Flex gap={8} align="center">
          <Input.Search
            allowClear
            placeholder={t('row_access.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <Button
            type="primary"
            disabled={!canWrite || !isDirty}
            loading={save.isPending}
            onClick={commit}
          >
            {t('common.save')}
          </Button>
        </Flex>

        <Flex vertical gap={2} style={{ background: COLORS.white, borderRadius: 8, padding: 8 }}>
          {isLoading && <Text type="secondary">{t('common.loading')}</Text>}
          {visible.map((row) => (
            <Checkbox
              key={row.id}
              aria-label={row.field_key}
              checked={current.has(row.field_key)}
              disabled={!canWrite}
              onChange={(e) => toggle(row.field_key, e.target.checked)}
            >
              <Text style={{ fontSize: 12 }}>
                R{row.row_number} · {row.label_en || row.field_key}{' '}
                <Text type="secondary" style={{ fontSize: 11 }}>{row.field_key}</Text>
              </Text>
            </Checkbox>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}
```

Check where `ROLE_CHOICES` actually lives — `grep -rn "ROLE_CHOICES" frontend/src/pages/admin/shipment-settings/SheetRowsTab.tsx` shows the import path — and use that path, not the guessed one.

- [ ] **Step 4: Wire the tab in**

In `frontend/src/pages/admin/ShipmentSettingsPage.tsx`, import the tab and add it after `sheet_rows`:

```tsx
  const canEditRowAccess = canDo(user, 'sheet_row_setting', 'edit');
```

```tsx
    ...(canEditRowAccess
      ? [{
          key: 'row_access',
          label: t('shipment_settings.tab_row_access'),
          children: <RowAccessTab canWrite={canEditRowAccess} />,
        }]
      : []),
```

- [ ] **Step 5: Add the i18n keys**

Add to all three of `frontend/src/i18n/en.json`, `ru.json`, `tk.json`:

```json
"row_access": {
  "hint": "Tick the rows this role may edit. This is the only place row access is granted.",
  "search": "Search rows"
},
"shipment_settings": { "tab_row_access": "Row access" }
```

Russian:

```json
"row_access": {
  "hint": "Отметьте строки, которые эта роль может редактировать. Доступ к строкам выдаётся только здесь.",
  "search": "Поиск строк"
},
"shipment_settings": { "tab_row_access": "Доступ к строкам" }
```

Turkmen:

```json
"row_access": {
  "hint": "Bu rolyň redaktirläp biljek setirlerini belläň. Setir rugsady diňe şu ýerden berilýär.",
  "search": "Setirleri gözle"
},
"shipment_settings": { "tab_row_access": "Setir rugsady" }
```

Merge these into the existing `shipment_settings` objects — do not create a second key.

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npm run test:run -- src/pages/admin/shipment-settings/RowAccessTab.test.tsx`
Expected: PASS.

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: no new errors.

- [ ] **Step 7: Stage and report**

```bash
git add frontend/src/pages/admin/shipment-settings/RowAccessTab.tsx \
        frontend/src/pages/admin/shipment-settings/RowAccessTab.test.tsx \
        frontend/src/pages/admin/ShipmentSettingsPage.tsx \
        frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
# feat(frontend): add Row access tab to Shipment Settings
```

---

### Task 10: Make the per-row access editor read-only

Without this the Row access tab is a *second* place writing the same `SheetRowRoleTrigger` rows — the thing the user explicitly asked to avoid. Also retires the lock switch: since Task 3, `is_locked` cannot change any outcome on a row that has triggers, and after the backfill every row has them.

**Files:**
- Modify: `frontend/src/pages/admin/shipment-settings/sheet-rows/SheetRowAccessSection.tsx`
- Modify: `frontend/src/pages/admin/shipment-settings/sheet-rows/SheetRowDetail.tsx` (drops the `is_locked` / `triggered_roles` draft wiring)
- Modify: `frontend/src/pages/admin/shipment-settings/SheetRowsTab.test.tsx` (existing assertions on the select/switch)

**Interfaces:**
- Consumes: `ISheetRowSetting.triggered_roles` (read).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/admin/shipment-settings/SheetRowsTab.test.tsx`:

```tsx
  it('does not offer any control that writes row access (AD-17)', async () => {
    renderTab();
    await screen.findByText('country');

    // Row access is granted on the Row access tab only. A select or switch here
    // would be a second writer for the same SheetRowRoleTrigger rows.
    expect(screen.queryByLabelText(/trigger roles/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /lock/i })).not.toBeInTheDocument();
  });
```

Match the existing render helper and query style in that file rather than copying these selectors verbatim.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:run -- src/pages/admin/shipment-settings/SheetRowsTab.test.tsx`
Expected: FAIL — both controls are present.

- [ ] **Step 3: Rewrite the section as read-only**

Replace `frontend/src/pages/admin/shipment-settings/sheet-rows/SheetRowAccessSection.tsx`:

```tsx
import { Alert, Flex, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { ROLE_COLOR } from '@/pages/admin/permissions/roleColors';

const { Text } = Typography;

interface ISheetRowAccessSectionProps {
  triggeredRoles: string[];
}

/**
 * Read-only since AD-17 (2026-09-02). Row access is granted on the Row access
 * tab and nowhere else — a select here would be a second writer for the same
 * SheetRowRoleTrigger rows, which is what the two-places bug was.
 *
 * The lock switch is gone too: with trigger config present the answer is
 * has_any_trigger whether or not the row is locked, so the control no longer
 * changed any outcome.
 */
export function SheetRowAccessSection({ triggeredRoles }: ISheetRowAccessSectionProps) {
  const { t } = useTranslation();

  return (
    <Flex vertical gap={8}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('sheet_rows.access_readonly_label')}
      </Text>

      {triggeredRoles.length === 0 ? (
        <Alert type="warning" showIcon message={t('sheet_rows.access_none')} />
      ) : (
        <Flex wrap gap={4}>
          {triggeredRoles.map((role) => (
            <Tag key={role} color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 11 }}>
              {role}
            </Tag>
          ))}
        </Flex>
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('sheet_rows.access_edit_hint')}
      </Text>
    </Flex>
  );
}
```

- [ ] **Step 4: Update the caller**

In `SheetRowDetail.tsx`, pass only `triggeredRoles={record.triggered_roles}` and delete the `is_locked` / `triggered_roles` entries from the draft state and the save payload. Leave `triggered_user` alone — per-user exceptions move in a follow-up, not here.

- [ ] **Step 5: Add the i18n keys**

Add `sheet_rows.access_readonly_label`, `sheet_rows.access_none`, `sheet_rows.access_edit_hint` to all three locale files. Remove the now-unused `sheet_rows.locked_label`, `access_lock_note`, `access_desc_triggered`, `access_desc_locked_empty`, `access_desc_open` keys from all three.

English:

```json
"access_readonly_label": "Who may edit this row",
"access_none": "No role can edit this row yet.",
"access_edit_hint": "Grant access on the Row access tab."
```

Russian:

```json
"access_readonly_label": "Кто может редактировать эту строку",
"access_none": "Пока ни одна роль не может редактировать эту строку.",
"access_edit_hint": "Доступ выдаётся на вкладке «Доступ к строкам»."
```

Turkmen:

```json
"access_readonly_label": "Bu setiri kim redaktirläp bilýär",
"access_none": "Häzirlikçe hiç bir rol bu setiri redaktirläp bilmeýär.",
"access_edit_hint": "Rugsat «Setir rugsady» goşmaça sahypasynda berilýär."
```

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npm run test:run -- src/pages/admin/shipment-settings/`
Expected: PASS. Existing tests that toggle the lock switch or the roles select must be deleted, not adapted — the controls are intentionally gone.

Run: `cd frontend && npm run test:run`
Expected: no new failures against the current baseline.

- [ ] **Step 7: Stage and report**

```bash
git add frontend/src/pages/admin/shipment-settings/ frontend/src/i18n/
# refactor(frontend): make per-row access read-only, one place to grant (AD-17)
```

---

### Task 11: Documentation

**Files:**
- Modify: `docs/ADR.md`
- Modify: `docs/obsidian/screens/shipment-sheet.md`
- Modify: `docs/obsidian/screens/` — the Shipment Settings page doc (find with `ls docs/obsidian/screens/ | grep -i setting`)
- Modify: `docs/obsidian/processes/` — the roles/permissions process doc
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`

- [ ] **Step 1: Write the ADR entry**

Append to `docs/ADR.md`, following the existing AD-N format and using the next free number:

```markdown
## AD-17 — Sheet row triggers are the edit permission

**Date:** 2026-09-02

**Context:** Whether a role could edit a Sheet cell required two tables to
agree: `SheetRowSetting.role_triggers` (Shipment Settings) AND
`RoleFieldPermission` (Permissions admin). Nothing kept them in sync — three
regressions on that path between 2026-08-24 and 2026-09-02. The actual write
gate (`ShipmentPatchSerializer`) read only the second table, so the Shipment
Settings screen never controlled the write at all.

**Decision:** For any field owned by a Sheet row, the row's trigger config IS
the permission. `can_edit_sheet_field` no longer AND-composes
`RoleFieldPermission`, and `ShipmentPatchSerializer`, the junction endpoints,
the bulk ops and `/contracts/shipment-packing/` all route through the same gate.
Fields with no Sheet row keep `RoleFieldPermission`.

Sub-decisions:
- `is_visible` is presentation, not permission — the write path ignores it.
- A reverse-delegate map routes real columns written by composite cells
  (`box_count` → `packing`, `truck_head_id` → `truck_plate`, …) to their row.
- `is_locked` is retired from the UI: with trigger config present it changes no
  outcome.
- Row access is granted in exactly one place, the Row access tab.
- `/admin/sheet-rows/` moves off `shipment.can_edit` to its own
  `sheet_row_setting` resource — writing there now means granting a permission.

**Consequences:** One screen, one table, one gate. `RoleFieldPermission` remains
for non-Sheet shipment fields (`notes`, `loading_location`, `peregruz_city`,
`price_per_kg`, `total_amount_usd`, `product_type`, `shelf_life_days`) and every
other resource. A backfill migration mirrors the old grants into triggers so no
role loses access; wildcard (`'*'`) holders such as `boss` are expanded across
all rows because `has_any_config` is per row.
```

- [ ] **Step 2: Update the Obsidian docs**

In `docs/obsidian/screens/shipment-sheet.md`, replace the permission section's "AND of trigger and field permission" description with the AD-17 rule, and list the reverse delegates.

In the Shipment Settings screen doc, document the Row access tab (role sidebar, checkbox list, replace-semantics on save) and note that the Sheet rows tab's access section is read-only.

In the roles/permissions process doc, state that Sheet-row access is granted in Shipment Settings → Row access, and that the Permissions admin now covers only non-Sheet fields, pages and resources.

- [ ] **Step 3: Update CHANGELOG**

Add under `[Unreleased]`:

```markdown
### Changed
- Sheet row triggers are now the edit permission for Sheet-owned fields (AD-17) — Shipment Settings is the single authority
- `/admin/sheet-rows/` gated on the new admin-only `sheet_row_setting` resource instead of `shipment.can_edit`
- Per-row access editor is read-only; the lock switch is retired

### Added
- Shipment Settings → Row access tab: pick a role, tick the rows it may edit
- `POST /export/admin/sheet-rows/role-access/` bulk endpoint

### Fixed
- `document_team` could not edit destination country / import firm despite being added in Shipment Settings

### Data
- Backfilled Sheet row triggers from existing field grants so no role loses write access
```

- [ ] **Step 4: Log the build**

Add to the top of `BUILD_TEST_LOG.md`:

```markdown
- [ ] 2026-09-02 — Sheet Settings becomes the permission authority (AD-17): trigger-only gate, write-path switch, Row access tab, sheet_row_setting resource, trigger backfill — NEEDS TEST
```

- [ ] **Step 5: Stage and report**

```bash
git add docs/ADR.md docs/obsidian/ CHANGELOG.md BUILD_TEST_LOG.md
# docs: record AD-17 — Sheet Settings is the permission authority
```

Then tell the user: **"Built — NOT tested yet. Did you test it?"**

---

## Explicitly deferred

The spec's Decision E allows moving per-user exceptions (`triggered_user`,
`user_permissions`) into the Row access tab as a second sidebar group. This plan
**does not** do that — Task 10 leaves the per-user editor on the Sheet rows tab
untouched. The "one place" rule therefore holds for **roles** in this plan, and
per-person overrides remain where they are. Ship it as a follow-up plan; nothing
here blocks it.

## Deployment notes

Order matters on beta and production:

1. `python manage.py migrate` — applies Task 1's grant and Task 4's backfill.
2. Verify the backfill: `python manage.py backfill_sheet_row_triggers` must report `Added 0 role triggers.`
3. Spot-check `boss` and `document_team` on the live DB before letting users in:
   ```python
   from apps.core.permissions import get_sheet_edit_map
   from django.contrib.auth import get_user_model
   u = get_user_model().objects.get(role='boss')
   print([k for k, v in get_sheet_edit_map(u).items() if not v])   # expect []
   ```
4. If `seed_permissions --reset` is ever run afterwards, re-run
   `backfill_sheet_row_triggers` — the reset wipes `RoleFieldPermission`, and the
   triggers stay, but the two should be re-reconciled.
