/**
 * Resource codes that appear in the permission matrix but are NOT enforced by it.
 *
 * Audited 2026-08-27 against the backend. For each of these, the admin can tick
 * all four boxes and nothing changes — the real decision is made by a hardcoded
 * role list in the view, or by nobody at all. Marking them in the UI is honest;
 * the fix is to move each one onto its own `resource_code` gate (the way
 * `packing_template` was fixed on 2026-08-27), tracked separately.
 *
 * `reason` is shown in the row's tooltip so the admin knows where to look
 * instead of ticking a box that does nothing.
 */
export interface IDeadResource {
  /** Where the decision actually happens. */
  reason: string;
  /** Source location, for the tooltip's second line. */
  where: string;
}

export const DEAD_RESOURCES: Record<string, IDeadResource> = {
  pallet: {
    reason: 'PALLET_WRITE_ROLES',
    where: 'export/views.py:100 + in-body checks at 3012 / 3064 / 3164',
  },
  manifest_close: {
    reason: 'PALLET_WRITE_ROLES',
    where: 'export/views.py:100 — same `is_pallet_write` branch',
  },
  sales_report: {
    reason: "PRIVILEGED_ROLES | {'sales_rep'}",
    where: 'export/views.py — inside set_sales_report()',
  },
  quality_document: {
    reason: "PRIVILEGED_ROLES | {'document_team'}",
    where: 'export/views.py:2627 — inside set_quality()',
  },
  shipment_assign: {
    reason: 'export_manager / director / boss',
    where: 'export/views.py — inside assign()',
  },
  domestic_sale: {
    reason: 'write_permission(*_DOMESTIC_WRITE_ROLES)',
    where: 'greenhouse/views.py:520',
  },
  weekly_plan: {
    reason: 'HARVEST_DAY_WRITE',
    where: 'export/views_harvest_forecast.py — in-body check',
  },
  greenhouse_block: {
    reason: 'nobody — read-only viewset, writes are not exposed at all',
    where: 'core/views.py:193 — ReadOnlyModelViewSet + IsAuthenticated',
  },
};

export function isDeadResource(code: string): boolean {
  return code in DEAD_RESOURCES;
}
