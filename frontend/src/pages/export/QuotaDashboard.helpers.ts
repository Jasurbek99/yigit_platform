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

/**
 * The season the quota page reads: its own dropdown, else the active season in
 * the list it could load, else the active season from `/auth/me/`.
 *
 * The last fallback is the fix for an empty Firm Quota tab. `useSeasons()` calls
 * `GET /export/admin/seasons/`, gated on `season.can_view` — held by admin /
 * director / export_manager / boss / finansist only. But the quota tabs are
 * gated on `quota_issuance.can_view`, which `document_team`,
 * `loading_dept_head` and `loading_dept_head_deputy` also hold. Those three saw
 * every tab while the seasons request 403'd, so `selectableSeasons` was empty
 * and the page had NO season id: `useQuotaFirmSummary` is `enabled: !!seasonId`
 * and never fired (an empty table, no error), while `useQuotaDashboard` sent
 * `season=0`, which `resolve_season()` answers with a 404 — the KPI row and the
 * Firm Breakdown / Chart / Weekly tabs were broken for them too.
 *
 * `/auth/me/` carries `active_season` for EVERY authenticated role, so it
 * resolves without widening anyone's permissions. Owner's call (2026-08-28):
 * these roles stay pinned to the active season rather than gaining
 * `season.can_view` — their dropdown legitimately has nothing to offer.
 *
 * Deliberately takes the id from `/auth/me/` and NOT from `useSelectedSeason()`,
 * which also reads the global header switcher: mixing that with this page's own
 * dropdown is the split-season bug commit 92480a9 fixed.
 */
export function resolveQuotaSeasonId(
  selectedSeasonId: number | undefined,
  selectableSeasons: ISeason[],
  activeSeasonId: number | null | undefined,
): number | undefined {
  const listed = selectableSeasons.find((s) => s.is_active) ?? selectableSeasons[0];
  return selectedSeasonId ?? listed?.id ?? activeSeasonId ?? undefined;
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
