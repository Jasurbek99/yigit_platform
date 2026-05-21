# services/ package — re-exports from sub-modules for backward compatibility.
#
# Existing code that does:
#   from apps.export.services import TRANSITIONS, transition_to, create_shipment
# continues to work unchanged because these names are re-exported here.
#
# New analytics code imports from apps.export.services.boss_analytics directly.

from .shipment import (
    STATUS_TIMESTAMP_MAP,
    TRANSITIONS,
    PRIVILEGED_ROLES,
    STATUS_NOTIFY_ROLES,
    _edge_to,
    _write_ad1_timestamp,
    _cancel_open_tasks,
    transition_to,
    _notify_action_required,
    create_shipment,
    submit_local_sell_plan,
    approve_local_sell_plan,
    reject_local_sell_plan,
    compute_dominant_varieties,
    close_pallet_manifest,
    override_dominant_varieties,
)

from . import comments as comments  # noqa: F401  — makes services.comments importable

from .boss_analytics import (
    period_to_range,
    _aggregate_summary,
    _aggregate_revenue,
    _aggregate_route_pnl,
    _aggregate_quota_grid,
    _aggregate_blocks_heatmap,
    _aggregate_top_customers,
    _aggregate_compliance,
    _aggregate_ops_pulse,
    _aggregate_risk_matrix,
    _aggregate_production,
    _aggregate_export_market,
    _aggregate_alerts,
    _placeholder_debt,
)

__all__ = [
    # Shipment lifecycle
    'STATUS_TIMESTAMP_MAP',
    'TRANSITIONS',
    'PRIVILEGED_ROLES',
    'STATUS_NOTIFY_ROLES',
    '_edge_to',
    '_write_ad1_timestamp',
    '_cancel_open_tasks',
    'transition_to',
    '_notify_action_required',
    'create_shipment',
    'submit_local_sell_plan',
    'approve_local_sell_plan',
    'reject_local_sell_plan',
    'compute_dominant_varieties',
    'close_pallet_manifest',
    'override_dominant_varieties',
    # Boss analytics
    'period_to_range',
    '_aggregate_summary',
    '_aggregate_revenue',
    '_aggregate_route_pnl',
    '_aggregate_quota_grid',
    '_aggregate_blocks_heatmap',
    '_aggregate_top_customers',
    '_aggregate_compliance',
    '_aggregate_ops_pulse',
    '_aggregate_risk_matrix',
    '_aggregate_production',
    '_aggregate_export_market',
    '_aggregate_alerts',
    '_placeholder_debt',
]
