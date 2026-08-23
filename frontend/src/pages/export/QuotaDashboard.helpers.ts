import { canDo, canSeePage } from '@/utils/permissions';
import type { ICurrentUser, ISeason } from '@/types';

/**
 * The seasons a user may pick in the quota dashboard's own season filter.
 *
 * `GET /export/quota-dashboard/` now resolves `?season=` through
 * `resolve_season()` like every other read path, so selecting a closed season
 * without `closed_season.can_view` returns 403 — which the page can only
 * render as "Failed to load quota data". Hiding the option is the honest
 * answer: the same rule the header `SeasonSwitcher` applies.
 *
 * UPCOMING seasons stay listed (unlike in the header switcher) — they are
 * pickable today, they carry no permission gate, and an upcoming season simply
 * aggregates to zero.
 */
export function seasonsVisibleTo(seasons: ISeason[], canViewClosed: boolean): ISeason[] {
  if (canViewClosed) return seasons;
  return seasons.filter((s) => s.status !== 'CLOSED');
}

/** What a user may see on the quota dashboard route. */
export interface IQuotaPanelAccess {
  /** The quota machinery: KPI pipeline, period filters, usage / issuance / firm tabs. */
  canSeeQuota: boolean;
  /** The Local Sell Plan grid. */
  canSeeLocalSell: boolean;
  /** The comparison charts (Firm Chart, Weekly Trend). */
  canSeeAnalytics: boolean;
}

/**
 * Splits the quota page's audience into "quota" and "sell plan only".
 *
 * `canSeeQuota` reads the RESOURCE permission, deliberately NOT
 * `canSeePage(user, 'export.quota')`. `canSeePage` treats access to ANY child
 * page as access to the parent, so `export.quota.local_sell` — the seller's
 * one page — made `export.quota` resolve true. That is right for the sidebar
 * (the seller must reach this route to get their grid) and wrong for
 * everything on it: the seller got the KPI row, the usage/issuance tabs and a
 * `GET /export/quota-dashboard/` that 403s, painting "Failed to load quota
 * data" on every visit (2026-08-23). `quota_issuance` is the exact
 * `resource_code` that endpoint enforces, so the UI now asks the same question
 * the API answers. Verified against the live matrix: no role holds
 * `quota_usage` without `quota_issuance`, so one flag covers both tabs.
 *
 * `canSeeAnalytics` is a conjunction of two distinct questions — the first
 * term is "this is quota data" (the charts render `per_firm` / `weekly_flow`
 * from the dashboard payload), the second excludes `document_team`, which
 * holds quota but not the sell plan and gets the read-only tabs only.
 */
export function quotaPanelAccess(user: ICurrentUser | null): IQuotaPanelAccess {
  const canSeeQuota = canDo(user, 'quota_issuance', 'view');
  return {
    canSeeQuota,
    canSeeLocalSell: canSeePage(user, 'export.quota.local_sell'),
    canSeeAnalytics: canSeeQuota && canDo(user, 'local_sell_plan', 'view'),
  };
}
