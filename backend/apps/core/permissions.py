"""Role-based permissions: field-level editing, dynamic resource CRUD, and legacy helpers.

Used by:
  - apps.core.serializers.UserMeSerializer (editable_fields in /auth/me/)
  - apps.export.serializers.ShipmentPatchSerializer (field validation)
  - ViewSets with resource_code attribute (DynamicResourcePermission)
"""
import logging

from django.core.cache import cache
from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.core.roles import PRIVILEGED_ROLES as PRIVILEGED_ROLES  # re-export for back-compat

logger = logging.getLogger(__name__)

PERM_CACHE_PREFIX = 'dynamic_perms'
PERM_CACHE_TTL = 60  # seconds

# Virtual sheet rows: cells that display & edit two real fields combined. The
# row's SheetRowSetting + frontend editor are keyed on the virtual key, but the
# underlying PATCH targets the real fields, so the field-perm gate delegates to
# one of them. transit_days_temp (R26) edits transit_days + transport_temp_c.
# Must be shared by can_edit_sheet_field AND get_sheet_edit_map so the inline
# edit gate and the frontend's can_current_user_edit map never disagree.
_VIRTUAL_FIELD_DELEGATES = {'transit_days_temp': 'transit_days'}

# Junction sheet rows: fields that live on a related table (ShipmentFirmSplit,
# ShipmentBlockSource), not on Shipment itself. Their RoleFieldPermission is
# scoped to the junction's own resource_code, per RESOURCE_FIELDS in
# permission_registry.py — 'firm_splits'/'block_sources' can never appear in a
# 'shipment' grant because they aren't in that resource's field list. Maps the
# sheet field_key to (resource_code, field_name) on the junction resource.
# Must be shared by can_edit_sheet_field AND get_sheet_edit_map so the inline
# edit gate and the frontend's can_current_user_edit map never disagree —
# mirrors _VIRTUAL_FIELD_DELEGATES, but crosses resources instead of staying
# within 'shipment'.
_JUNCTION_FIELD_DELEGATES: dict[str, tuple[str, str]] = {
    'firm_splits': ('shipment_firm_split', 'export_firm'),
    'block_sources': ('shipment_block_source', 'block'),
}


def _can_edit_sheet_row_field(role: str | None, field_key: str) -> bool:
    """Field-perm check for a Sheet row, resolving junction rows to their real
    resource_code (see _JUNCTION_FIELD_DELEGATES) instead of 'shipment'."""
    resource_code, field_name = _JUNCTION_FIELD_DELEGATES.get(field_key, ('shipment', field_key))
    return can_edit_field(role, field_name, resource_code=resource_code)


def get_editable_fields(role: str | None, resource_code: str = 'shipment') -> list[str]:
    """Return the list of fields editable by the given role for a resource.

    Reads from the RoleFieldPermission table (populated by seed_permissions).
    Returns [] if no rows exist — fail-closed.
    """
    from apps.core.models import RoleFieldPermission

    if not role:
        return []

    cache_key = f'{PERM_CACHE_PREFIX}:fields:{role}:{resource_code}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    fields = list(
        RoleFieldPermission.objects.filter(
            role=role, resource_code=resource_code,
        ).values_list('field_name', flat=True)
    )
    cache.set(cache_key, fields, PERM_CACHE_TTL)
    return fields


def can_edit_field(role: str | None, field: str, resource_code: str = 'shipment') -> bool:
    """Return True if the role may edit the given field on a resource."""
    allowed = get_editable_fields(role, resource_code)
    return '*' in allowed or field in allowed


# ── Dynamic resource permission helpers ──────────────────────────────────

def get_resource_perm(role: str, resource_code: str) -> dict | None:
    """Fetch RoleResourcePermission as a plain dict from cache or DB.

    Returns dict with keys: can_view, can_create, can_edit, can_delete.
    Returns None if no permission row exists.
    Stores plain dicts (not model instances) to avoid pickle issues on schema changes.
    """
    from apps.core.models import RoleResourcePermission

    cache_key = f'{PERM_CACHE_PREFIX}:resource:{role}:{resource_code}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached if cached != '__none__' else None

    try:
        perm = RoleResourcePermission.objects.get(role=role, resource_code=resource_code)
        perm_dict = {
            'can_view': perm.can_view,
            'can_create': perm.can_create,
            'can_edit': perm.can_edit,
            'can_delete': perm.can_delete,
        }
    except RoleResourcePermission.DoesNotExist:
        perm_dict = None

    cache.set(cache_key, perm_dict if perm_dict else '__none__', PERM_CACHE_TTL)
    return perm_dict


def get_page_permissions(role: str) -> dict[str, bool]:
    """Return {page_code: is_visible} for a role. Used by /auth/me/."""
    from apps.core.models import RolePagePermission

    cache_key = f'{PERM_CACHE_PREFIX}:pages:{role}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = dict(
        RolePagePermission.objects.filter(role=role)
        .values_list('page_code', 'is_visible')
    )
    cache.set(cache_key, result, PERM_CACHE_TTL)
    return result


def get_resource_permissions(role: str) -> dict[str, dict[str, bool]]:
    """Return {resource_code: {view, create, edit, delete}} for a role."""
    from apps.core.models import RoleResourcePermission

    cache_key = f'{PERM_CACHE_PREFIX}:resources:{role}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = RoleResourcePermission.objects.filter(role=role).values(
        'resource_code', 'can_view', 'can_create', 'can_edit', 'can_delete',
    )
    result = {
        r['resource_code']: {
            'view': r['can_view'],
            'create': r['can_create'],
            'edit': r['can_edit'],
            'delete': r['can_delete'],
        }
        for r in rows
    }
    cache.set(cache_key, result, PERM_CACHE_TTL)
    return result


def get_all_field_permissions(role: str) -> dict[str, list[str]]:
    """Return {resource_code: [field_name, ...]} for a role."""
    from apps.core.models import RoleFieldPermission

    cache_key = f'{PERM_CACHE_PREFIX}:all_fields:{role}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = RoleFieldPermission.objects.filter(role=role).values_list(
        'resource_code', 'field_name',
    )
    result: dict[str, list[str]] = {}
    for resource_code, field_name in rows:
        result.setdefault(resource_code, []).append(field_name)
    cache.set(cache_key, result, PERM_CACHE_TTL)
    return result


def write_permission(*roles: str) -> type:
    """Return a DRF permission class that allows reads to all but writes only to the given roles.

    Usage:
        permission_classes = [IsAuthenticated, write_permission('export_manager', 'director')]
    """
    _allowed = frozenset(roles)

    class _WriteRolePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            if request.method in SAFE_METHODS:
                return True
            if getattr(request.user, 'is_superuser', False):
                return True
            return getattr(request.user, 'role', None) in _allowed

    return _WriteRolePermission


def resource_write_permission(resource_code: str) -> type:
    """DRF permission for a catalog ViewSet whose READS stay open to every
    authenticated user while its WRITES follow RoleResourcePermission.

    Why not DynamicResourcePermission: that class gates GET on ``can_view``, so
    every role without a row for ``resource_code`` loses read access. Some
    catalogs are picked from all over the app (e.g. the packing-template
    dropdown in the Sheet packing panel), so reads must stay open the way
    ``write_permission`` leaves them — but the write side belongs in the
    permission matrix, not in a hardcoded role tuple.

    Maps: POST → can_create, PUT/PATCH → can_edit, DELETE → can_delete.
    No row for the role → no writes (fail-closed). Superusers bypass.

    Usage:
        permission_classes = [IsAuthenticated, resource_write_permission('packing_template')]
    """
    class _ResourceWritePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            if request.method in SAFE_METHODS:
                return True
            if getattr(request.user, 'is_superuser', False):
                return True
            role = getattr(request.user, 'role', None)
            if not role:
                return False
            perm = get_resource_perm(role, resource_code)
            if not perm:
                return False
            if request.method == 'POST':
                return perm['can_create']
            if request.method == 'DELETE':
                return perm['can_delete']
            return perm['can_edit']

    return _ResourceWritePermission


def firm_write_permission(app_label: str, model_name: str, *bypass_roles: str) -> type:
    """Permission class for model CRUD that supports both role-based and Django permission-based access.

    Writes allowed when ANY of these is true:
    - user.is_superuser
    - user.role in bypass_roles
    - user has the action-specific Django permission (add/change/delete)

    Usage:
        permission_classes = [IsAuthenticated, firm_write_permission('core', 'exportfirm', 'director')]
    """
    _bypass = frozenset(bypass_roles)
    _method_perm = {
        'POST':   f'{app_label}.add_{model_name}',
        'PUT':    f'{app_label}.change_{model_name}',
        'PATCH':  f'{app_label}.change_{model_name}',
        'DELETE': f'{app_label}.delete_{model_name}',
    }

    class _FirmWritePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            if request.method in SAFE_METHODS:
                return True
            if getattr(request.user, 'is_superuser', False):
                return True
            if getattr(request.user, 'role', None) in _bypass:
                return True
            perm = _method_perm.get(request.method)
            return bool(perm and request.user.has_perm(perm))

    return _FirmWritePermission


def can_edit_sheet_field(user, field_key: str) -> bool:
    """Gate a shipment sheet cell edit against role/user trigger config + field perm.

    Logic (Sheet Control v2 — ADR-0001, ADR-0010):
      1. superuser / admin / director → always True (bypass all gates; AD-15).
         Checked BEFORE visibility so admin can always fix misconfiguration.
      2. Load SheetRowSetting via objects.active(). If None → fall back to
         can_edit_field (preserves TestNoSettingFallsBackToFieldPerm).
      3. If not row.is_visible → False.
      4. Compute match flags:
         - matched_user  = (user.id == row.triggered_user_id AND user is active)
         - matched_role  = user.role in {rt.role for rt in row.role_triggers.all()}
         - matched_extra = active user_permissions grant for this user
      5. If row.is_locked:
           return (matched_user OR matched_role OR matched_extra)
                  AND can_edit_field(role, field_key)
         (lock + extra_users exception per ADR-0001; role triggers are also exceptions)
      6. Else (not locked):
           if no trigger config exists → fall back to can_edit_field alone
           else: return (matched_user OR matched_role OR matched_extra) AND field perm

    The trigger gate is AND-composed with the RoleFieldPermission check, never OR.

    Args:
        user: The authenticated User instance.
        field_key: The sheet row field_key (matches DEFAULT_SHEET_ROWS entries).

    Returns:
        True if the user is permitted to edit this cell, False otherwise.
    """
    # Rule 1: superuser / admin / director / export_manager bypass all gates
    # (per plan D4 + AD-15). export_manager (Gadam J) is the operational owner
    # of the shipment lifecycle and must be able to edit any Sheet cell to
    # unstick a stalled truck, regardless of trigger/lock config.
    role = getattr(user, 'role', None)
    if getattr(user, 'is_superuser', False) or role in ('admin', 'director', 'export_manager'):
        return True

    # Virtual sheet rows delegate to their real underlying field (module-level
    # _VIRTUAL_FIELD_DELEGATES, shared with get_sheet_edit_map).
    delegate_key = _VIRTUAL_FIELD_DELEGATES.get(field_key)
    if delegate_key is not None:
        return can_edit_sheet_field(user, delegate_key)

    # Import lazily to avoid circular import
    from apps.export.models import SheetRowSetting

    setting = SheetRowSetting.objects.active().filter(field_key=field_key).prefetch_related(
        'role_triggers', 'user_permissions',
    ).first()

    # Rule 2: no active setting → standard field-perm fallback
    if setting is None:
        return _can_edit_sheet_row_field(role, field_key)

    # Rule 3: hidden rows → no edit for anyone
    if not setting.is_visible:
        return False

    # Rule 4: compute match flags using prefetched relations (no extra queries)
    triggered_user = setting.triggered_user if setting.triggered_user_id else None
    matched_user = (
        triggered_user is not None
        and triggered_user.is_active
        and user.id == setting.triggered_user_id
    )
    role_set = {rt.role for rt in setting.role_triggers.all()}
    matched_role = bool(role and role in role_set)
    matched_extra = any(
        up.user_id == user.id and up.can_edit and up.deleted_at is None
        for up in setting.user_permissions.all()
    )

    has_any_trigger = matched_user or matched_role or matched_extra
    # Determine if any trigger config exists on this setting
    has_any_config = bool(
        setting.triggered_user_id
        or role_set
        or any(up.deleted_at is None for up in setting.user_permissions.all())
    )

    # Rule 5/6: apply lock or fallback
    if setting.is_locked:
        return has_any_trigger and _can_edit_sheet_row_field(role, field_key)
    else:
        if not has_any_config:
            # No triggers configured → fall back to field perm alone
            return _can_edit_sheet_row_field(role, field_key)
        return has_any_trigger and _can_edit_sheet_row_field(role, field_key)


def get_sheet_edit_map(user, settings_by_key: dict | None = None) -> dict[str, bool]:
    """Return {field_key: can_edit} for every row in DEFAULT_SHEET_ROWS.

    Sheet Control v2 implementation. Query budget:
      1. SheetRowSetting.objects.active() with prefetch_related('role_triggers',
         'user_permissions') — skipped if settings_by_key is passed in.
      2. get_all_field_permissions(user.role) — one query or cache hit.
      Prefetch relations add 2 extra SELECTs making the real total ~4 when cold.
      This is an acceptable trade-off for correct multi-role/user logic.
      TestGetSheetEditMapQueryCount is updated accordingly (≤4 queries).

    Director, admin, and superuser get all-True maps without any DB queries.

    Args:
        user: The authenticated User instance.
        settings_by_key: Optional pre-loaded {field_key: SheetRowSetting}.
            Must already have role_triggers and user_permissions prefetched.
            Pass from the /sheet/ view to avoid a duplicate settings query.

    Returns:
        Dict mapping each DEFAULT_SHEET_ROWS field_key to a boolean.
    """
    # Import lazily to avoid circular import
    from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
    from apps.export.models import SheetRowSetting

    # Privileged bypass: no DB queries needed.
    # export_manager (Gadam J) bypasses all gates — see can_edit_sheet_field Rule 1.
    role = getattr(user, 'role', None)
    if getattr(user, 'is_superuser', False) or role in ('admin', 'director', 'export_manager'):
        return {row['field_key']: True for row in DEFAULT_SHEET_ROWS}

    # Query 1 (+2 prefetch SELECTs): load active settings with triggers and perms
    if settings_by_key is None:
        settings_by_key = {
            s.field_key: s
            for s in SheetRowSetting.objects.active().select_related(
                'triggered_user',
            ).prefetch_related(
                'role_triggers',
                'user_permissions',
            )
        }

    # Query 2 (or cache hit): load all field permissions for this role
    all_perms = get_all_field_permissions(role or '')

    def _has_field_perm(fk: str) -> bool:
        # Junction rows (firm_splits, block_sources) check their own
        # resource_code — see _JUNCTION_FIELD_DELEGATES — never 'shipment'.
        resource_code, field_name = _JUNCTION_FIELD_DELEGATES.get(fk, ('shipment', fk))
        fields = all_perms.get(resource_code, [])
        return '*' in fields or field_name in fields

    def _resolve(fk: str) -> bool:
        """Evaluate trigger + field-perm for a single field_key."""
        # Virtual rows delegate to their real underlying field, mirroring
        # can_edit_sheet_field so the inline gate and this map never disagree.
        delegate_key = _VIRTUAL_FIELD_DELEGATES.get(fk)
        if delegate_key is not None:
            return _resolve(delegate_key)

        setting = settings_by_key.get(fk)

        if setting is None:
            return _has_field_perm(fk)

        if not setting.is_visible:
            return False

        # Compute match flags using prefetched relations (no extra queries)
        triggered_user = setting.triggered_user if setting.triggered_user_id else None
        matched_user = (
            triggered_user is not None
            and triggered_user.is_active
            and user.id == setting.triggered_user_id
        )
        role_set = {rt.role for rt in setting.role_triggers.all()}
        matched_role = bool(role and role in role_set)
        matched_extra = any(
            up.user_id == user.id and up.can_edit and up.deleted_at is None
            for up in setting.user_permissions.all()
        )

        has_any_trigger = matched_user or matched_role or matched_extra
        has_any_config = bool(
            setting.triggered_user_id
            or role_set
            or any(up.deleted_at is None for up in setting.user_permissions.all())
        )

        if setting.is_locked:
            return has_any_trigger and _has_field_perm(fk)
        else:
            if not has_any_config:
                return _has_field_perm(fk)
            return has_any_trigger and _has_field_perm(fk)

    return {row['field_key']: _resolve(row['field_key']) for row in DEFAULT_SHEET_ROWS}


# TODO: Rename to IsBossDirectorOrAdmin in a follow-up refactor.
# Currently includes 'admin' despite the name. See AD-15.
class IsBossOrDirector(BasePermission):
    """Allow access only to users with role 'admin', 'boss', or 'director'.

    Used by BossAnalyticsViewSet. The analytics.boss page permission is
    enforced by the frontend; this class is the canonical server-side gate.
    Superusers bypass the check.
    """

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, 'is_superuser', False):
            return True
        return getattr(request.user, 'role', None) in ('admin', 'boss', 'director')


class SeasonNotClosed(BasePermission):
    """Blocks mutating requests against a closed season (D1).

    Layer 1 of the write freeze. Layer 2 (`assert_season_open` /
    `assert_bulk_seasons_open` inside the service and action bodies) is what
    actually holds the invariant, since the two-row Join, the bulk id-list
    actions and `transition_to()` do not all pass through DRF object
    permissions.

    Deliberately implements ONLY has_object_permission. A request-level check
    would have to guess the target row's season from `?season=`, and the
    frontend omits that param whenever the selection equals the active season
    — so a PATCH on a closed-season row would resolve to the *active* season
    and pass. `obj.season` is the only authoritative source.

    Creates need no request-level check either: new rows are stamped with
    `get_active_season()`, which can never be closed. A POST body carrying an
    explicit `season` is caught by layer 2 inside the create service.

    Raises SeasonClosedError (→ 409) rather than returning False (→ 403): the
    request is well-formed and the user is authorised in principle, it
    conflicts with the resource's *state*.
    """

    SAFE = ('GET', 'HEAD', 'OPTIONS')

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in self.SAFE:
            return True
        from apps.core.seasons import assert_season_open, freeze_season_of

        # freeze_season_of() is the single anchor definition, shared with
        # SeasonScopedMixin.assert_create_target_open(). It handles the plain
        # `season` FK, the join through `shipment`, and per-model overrides
        # (ContractSale reaches a Season through its non-nullable `contract`
        # when `shipment` is NULL).
        assert_season_open(freeze_season_of(obj))
        return True


class DynamicResourcePermission(BasePermission):
    """DRF permission class that checks RoleResourcePermission from the database.

    Usage on a ViewSet:
        resource_code = 'shipment'
        permission_classes = [IsAuthenticated, DynamicResourcePermission]

    Maps HTTP methods:
        GET/HEAD/OPTIONS → can_view
        POST             → can_create
        PUT/PATCH        → can_edit
        DELETE           → can_delete

    Superusers bypass all checks. If no resource_code is set on the view,
    the check is skipped (allows gradual migration).
    """

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, 'is_superuser', False):
            return True

        resource_code = getattr(view, 'resource_code', None)
        if not resource_code:
            return True  # no resource_code configured — skip dynamic check

        role = getattr(request.user, 'role', None)
        if not role:
            return False

        perm = get_resource_perm(role, resource_code)
        if not perm:
            return False

        if request.method in SAFE_METHODS:
            return perm['can_view']
        if request.method == 'POST':
            return perm['can_create']
        if request.method == 'DELETE':
            return perm['can_delete']
        # PUT, PATCH
        return perm['can_edit']


def junction_write_permission(resource_code: str) -> type:
    """DRF permission for a single POST action that REPLACES a shipment's
    related-table rows (e.g. firm splits, block sources) — pinned to that
    junction's own resource_code instead of the ViewSet's default
    ``resource_code`` ('shipment').

    Why not DynamicResourcePermission: it reads ``view.resource_code``, which
    is a single class-level attribute shared by every action on the ViewSet.
    A role can hold full CRUD on the junction resource (e.g. document_team's
    ``shipment_firm_split``: view/create/edit/delete) while correctly lacking
    ``shipment.can_create`` (it must not create new shipments) — so gating a
    firm-split save on ``shipment.can_create`` 403s a role the junction
    resource itself explicitly grants. Mirrors the ``set_sales_report``
    precedent (a POST that writes a different resource than the ViewSet's
    default) but as a reusable permission instead of an in-body check.

    Checks ``can_edit``, not ``can_create``: the action fully replaces the
    existing set (an edit of the shipment's composition), matching how the
    Sheet's own UI gate already treats this field (RoleFieldPermission /
    ``can_edit_sheet_field``), not a REST "create a new thing".

    Usage in ``get_permissions()``:
        if action == 'set_firm_splits':
            return [IsAuthenticated(), SeasonNotClosed(),
                    junction_write_permission('shipment_firm_split')()]
    """
    class _JunctionWritePermission(BasePermission):
        def has_permission(self, request, view) -> bool:
            if not request.user or not request.user.is_authenticated:
                return False
            if getattr(request.user, 'is_superuser', False):
                return True
            role = getattr(request.user, 'role', None)
            if not role:
                return False
            perm = get_resource_perm(role, resource_code)
            return bool(perm and perm['can_edit'])

    return _JunctionWritePermission
