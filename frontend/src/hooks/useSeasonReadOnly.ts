import { useAuth } from '@/hooks/useAuth';
import { useSeasons } from '@/hooks/useAdmin';
import { useSelectedSeason } from '@/hooks/useSeasonParam';

/**
 * True when the season currently being browsed is CLOSED — the only season
 * state the backend actually freezes writes for (`assert_season_open()` in
 * `apps/core/seasons.py` keys on `closed_at`, not on `is_active`). Drives the
 * banner and every disabled control. The backend's 409 (`season_closed`) is
 * the safety net, not the mechanism — a user should never be able to click
 * something that 409s, but this hook does not need to be stricter than the
 * backend to achieve that.
 *
 * Earlier version: "not the active season" == read-only. That was wrong for
 * an UPCOMING season (deactivated but not closed, e.g. via
 * `is_active=False`/`closed_at=None`) — the backend permits both reads AND
 * writes there, so marking it read-only disabled controls for a reason the
 * UI never explained and the backend never enforced.
 *
 * Two fast paths need no season-list data at all:
 * - No season resolved (`seasonId === null` — the close<->open gap with
 *   nothing explicitly selected): matches the backend's fail-closed READ
 *   scope (`resolve_season()` returns `None` when there is no active season
 *   and no `?season=` override -> every scoped `get_queryset()` returns
 *   `qs.none()`) — there is nothing to edit, so this stays read-only.
 * - The browsed season IS the user's active season: `uq_season_single_active`
 *   guarantees at most one row has `is_active=True`, and a season only
 *   becomes closed by explicitly deactivating it first — so the active
 *   season can never be closed. Always editable, no list lookup needed. This
 *   keeps the common case (a role with no `season` resource permission,
 *   browsing their own active season — most operational roles never see the
 *   switcher at all) working with only `/auth/me/`.
 *
 * When the list can't yet answer, PENDING and ERROR get opposite fallbacks —
 * conflating them regressed the exact bug this hook exists to catch (caught
 * in review before shipping):
 * - **Still fetching → fail CLOSED (read-only)**, briefly. A cold load into a
 *   pasted `?season=<closed id>` would otherwise render editable cells and
 *   arm autosave for the length of that request; typing during that window
 *   PATCHes, 409s, and rolls back — the exact silent-data-loss shape
 *   `ShipmentDetail.tsx` documents as the reason this gate exists at all.
 *   Flips to the real answer within one query resolution — a harmless
 *   disabled-then-enabled flicker, not the reverse.
 * - **Resolved with an error (or the id just isn't in a resolved list) → fail
 *   OPEN (editable).** `closed_season.can_view` (required to browse a CLOSED
 *   season at all — see `resolve_season()`) is held by exactly the five
 *   roles that also hold `season.can_view` (admin/director/export_manager/
 *   boss get it via their blanket resource grant, finansist gets it
 *   explicitly — see `seed_permissions.py` RESOURCE_DEFAULTS). So a
 *   RESOLVED 403 (not just "not yet loaded") PROVABLY means this user cannot
 *   legitimately be inside a CLOSED season — there is nothing left for
 *   fail-closed to protect against, and doing it anyway disables every
 *   control on a legitimately writable UPCOMING season with no explanation
 *   (e.g. `warehouse_chief` opening a pasted link into one). The residual
 *   gap — a hand-edited `RoleResourcePermission` granting `closed_season.
 *   can_view` without `season.can_view` — leaves a control enabled that
 *   409s; that 409 is exactly what the backend guard exists to catch.
 */
export function useSeasonReadOnly(): boolean {
  const { seasonId } = useSelectedSeason();
  const { user } = useAuth();
  const { data: seasons, isPending } = useSeasons();
  const activeSeasonId = user?.active_season?.id ?? null;

  if (seasonId === null) return true;
  if (seasonId === activeSeasonId) return false;
  if (isPending) return true;

  const selected = seasons?.find((s) => s.id === seasonId);
  return selected?.status === 'CLOSED';
}
