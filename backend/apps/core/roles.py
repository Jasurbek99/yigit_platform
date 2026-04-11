"""Centralized role constants for permission checks.

Single source of truth — all view/service files import from here.
"""

# Broad access
PRIVILEGED_ROLES = frozenset({'export_manager', 'director'})
DIRECTOR_ONLY = frozenset({'director'})

# Greenhouse / planning
PLAN_WRITE = frozenset({'greenhouse_manager', 'export_manager', 'director'})
PLAN_APPROVE = frozenset({'export_manager', 'director'})

# Domestic operations
DOMESTIC_WRITE = frozenset({'warehouse_chief', 'greenhouse_manager', 'export_manager', 'director'})

# Export logistics
TRUCK_WRITE = frozenset({'export_manager', 'director'})
PRICE_WRITE = frozenset({'export_manager', 'finansist', 'director'})
LOCAL_SELL_WRITE = frozenset({'export_manager', 'director', 'seller'})
LOCAL_SELL_APPROVE = frozenset({'export_manager', 'director'})

# Finance
ADVANCE_WRITE = frozenset({'finansist', 'director'})

# Quota
QUOTA_WRITE = frozenset({'export_manager', 'director'})
