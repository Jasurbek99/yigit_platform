"""Centralized role constants for permission checks.

Single source of truth — all view/service files import from here.
"""

# Sole top-tier system administrator. The admin role manages users and the
# permission matrix; director and export_manager are operational. See AD-15.
ADMIN_ONLY = frozenset({'admin'})

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
PLAN_WRITE = frozenset({'admin', 'greenhouse_manager', 'export_manager', 'director'})
PLAN_APPROVE = frozenset({'admin', 'export_manager', 'director'})

# Domestic operations
DOMESTIC_WRITE = frozenset({'admin', 'loading_dept_head', 'warehouse_chief', 'greenhouse_manager', 'export_manager', 'director'})

# Export logistics
TRUCK_WRITE = frozenset({'admin', 'export_manager', 'director'})
PRICE_WRITE = frozenset({'admin', 'export_manager', 'finansist', 'director'})
LOCAL_SELL_WRITE = frozenset({'admin', 'export_manager', 'director', 'seller'})
LOCAL_SELL_APPROVE = frozenset({'admin', 'export_manager', 'director'})

# Finance
ADVANCE_WRITE = frozenset({'admin', 'finansist', 'director'})

# Quota
QUOTA_WRITE = frozenset({'admin', 'export_manager', 'director'})
