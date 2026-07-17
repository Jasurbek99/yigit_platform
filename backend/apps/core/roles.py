"""Centralized role constants for permission checks.

Single source of truth — all view/service files import from here.
"""

# Sole top-tier system administrator. The admin role manages users and the
# permission matrix; director and export_manager are operational. See AD-15.
ADMIN_ONLY = frozenset({'admin'})

# ── Task ownership equivalence ────────────────────────────────────────────────
# Task.assignee_role holds ONE role, but some roles are operationally the same
# team: a deputy acts with identical authority to their head (stakeholder
# decision, June 2026). A task assigned to the head is therefore also the
# deputies' work — they must both SEE it and be able to ACT on it.
#
# Deliberately NOT derived from MANAGEABLE_BY_ROLE below: that is a *management*
# hierarchy and includes weight_master (21 users), who must not receive the
# loading department's tasks. Keep this map narrow and explicit.
TASK_ROLE_EQUIVALENTS = {
    'loading_dept_head': frozenset({'loading_dept_head', 'loading_dept_head_deputy'}),
    'loading_dept_head_deputy': frozenset({'loading_dept_head', 'loading_dept_head_deputy'}),
}


def task_roles_for(role: str | None) -> frozenset[str]:
    """Roles whose tasks ``role`` may see and act on.

    Always includes ``role`` itself. Roles with no declared equivalent map to
    just themselves, so this is safe to call unconditionally.

    Single source of truth — task visibility (MeTaskListView), task actions
    (IsTaskActor), and the KPI tiles (MeKpiTodayView) all call this, so the
    three cannot drift apart.

    Args:
        role: role code, or None for an anonymous/roleless user.

    Returns:
        Frozenset of role codes; empty when ``role`` is falsy.
    """
    if not role:
        return frozenset()
    return TASK_ROLE_EQUIVALENTS.get(role, frozenset({role}))

# Reference-data writes (countries, cities, customers, blocks, etc.) are
# operational, not administrative. Admin is a superset of director and EM.
REFERENCE_DATA_WRITE = frozenset({'admin', 'director', 'export_manager'})

# Audit log viewers — admin always; director/EM keep current visibility.
AUDIT_VIEWERS = frozenset({'admin', 'director', 'export_manager'})

# Broad operational access. Admin is implicitly included since admin is the
# system superuser; gates that use this set should never deny admin.
PRIVILEGED_ROLES = frozenset({'admin', 'export_manager', 'director'})

# Kept for back-compat with callers that still import it. Do NOT use for
# admin-only gates — use ADMIN_ONLY. Director is no longer the system admin.
DIRECTOR_ONLY = frozenset({'director'})

# Greenhouse / planning
# PLAN_WRITE and PLAN_APPROVE are removed — the approval workflow was dropped in
# the Forecast Layer feature (Apr 2026, see ADR-017). Use HARVEST_DAY_WRITE for
# write gates on plan/forecast/actual values.
# May 2026: warehouse_chief replaced by loading_dept_head (Soltanmyrat) for forecast
# writes; actual values are now computed by the daily shipment-rollup job.
HARVEST_DAY_WRITE = frozenset({'admin', 'greenhouse_manager', 'loading_dept_head', 'loading_dept_head_deputy'})
HARVEST_DAY_OVERRIDE = frozenset({'admin'})  # admin-only, with required `reason`

# Domestic operations
DOMESTIC_WRITE = frozenset({'admin', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief', 'greenhouse_manager', 'export_manager', 'director'})

# Export logistics
TRUCK_WRITE = frozenset({'admin', 'export_manager', 'director'})
PRICE_WRITE = frozenset({'admin', 'export_manager', 'finansist', 'director'})
LOCAL_SELL_WRITE = frozenset({'admin', 'export_manager', 'director', 'seller'})
LOCAL_SELL_APPROVE = frozenset({'admin', 'export_manager', 'director'})

# Finance
ADVANCE_WRITE = frozenset({'admin', 'finansist', 'director'})

# Quota
QUOTA_WRITE = frozenset({'admin', 'export_manager', 'director'})


# ---------------------------------------------------------------------------
# Delegated user management (ADR-022)
# ---------------------------------------------------------------------------
# A bounded exception to AD-15 (which keeps user/permission admin admin-only):
# a department head may create/edit/delete/reset-password a fixed set of
# subordinate roles, and grant those roles a subset of the head's own visible
# pages. The map below is the single source of truth for "who may manage whom".
#
# Security note: this is enforced server-side in UserManagementViewSet and the
# managed-page-permissions endpoint — the frontend role dropdown is UX only.
MANAGEABLE_BY_ROLE: dict[str, frozenset] = {
    'loading_dept_head': frozenset({'loading_dept_head_deputy', 'weight_master'}),
}


def manageable_roles(user) -> frozenset:
    """Return the set of role codes ``user`` may manage.

    Admins and superusers may manage every role. A delegated manager may manage
    only the roles listed for their role in ``MANAGEABLE_BY_ROLE``. Everyone
    else manages nobody.

    Args:
        user: The acting user (must expose ``role`` and ``is_superuser``).

    Returns:
        Frozenset of role codes the user is allowed to manage.
    """
    if getattr(user, 'is_superuser', False) or getattr(user, 'role', None) == 'admin':
        from apps.core.models.user import ROLE_CHOICES
        return frozenset(code for code, _ in ROLE_CHOICES)
    return MANAGEABLE_BY_ROLE.get(getattr(user, 'role', None), frozenset())


def can_manage_users(user) -> bool:
    """Whether ``user`` may manage at least one other role."""
    return bool(manageable_roles(user))
