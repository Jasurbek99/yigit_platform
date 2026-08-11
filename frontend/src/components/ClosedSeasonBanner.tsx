import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useSelectedSeason, useSwitchSeason } from '@/hooks/useSeasonParam';
import { hasArchiveAccess } from '@/utils/permissions';
import type { ISeason } from '@/types';

/**
 * Shown directly above routed content whenever the browsed season is
 * genuinely CLOSED, or when there is no active season at all (the
 * close→open gap).
 *
 * Still couples to `useSeasonReadOnly()` — that hook was rewritten (not this
 * component) so its boolean means exactly what this banner needs: post-fix,
 * `useSeasonReadOnly() === true` iff `seasonId === null` (nothing explicitly
 * selected during the gap) OR the selected season's `status === 'CLOSED'`.
 * That is precisely "genuinely closed, or the no-selection gap default" — so
 * `if (!isReadOnly) return null` already renders nothing for an UPCOMING
 * season (readable AND writable — `assert_season_open()` keys on
 * `closed_at`, not `is_active`) without this component needing to know
 * anything about season status itself. An earlier revision of this file
 * re-derived `status === 'CLOSED'` locally instead of trusting the hook;
 * that duplicated the hook's CLOSED check but dropped its gap-first
 * priority, so a CLOSED season explicitly pinned during the close→open gap
 * showed a "closed season, back to active" banner pointing at a
 * non-existent active season. Reverted — the hook's own priority order
 * (`seasonId === null` short-circuits before the CLOSED lookup) already
 * handles that case correctly.
 *
 * Per the design's §9.1 ruling (D8): inside a closed season, archived rows
 * are visible only to users who ALSO hold archive-view access — everyone
 * else legitimately sees a partial view of that season. The ruling accepted
 * this as a UI problem to mitigate, not a reason to widen the permission, so
 * this banner says so explicitly for users without that access rather than
 * leaving them to wonder why a row they remember is missing.
 */
export function ClosedSeasonBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const { seasonId: selectedSeasonId } = useSelectedSeason();
  const switchSeason = useSwitchSeason();
  const { data: seasons = [] } = useSeasons();

  if (!isReadOnly) return null;

  const activeId = user?.active_season?.id ?? null;

  // The close→open gap (§3.1): there is no active season yet, so nothing is
  // writable — but nothing is CLOSED either. Distinct wording, no "back to
  // active" (there is nothing to switch back to) — showing the closed-season
  // message here would misreport a real, expected operational state as a
  // permission restriction. Checked first and unconditionally within the
  // read-only branch, so a CLOSED season explicitly pinned during the gap
  // still gets this neutral message instead of a "back to active" button
  // with no active season to point at.
  if (activeId === null) {
    return (
      <Alert
        type="info"
        showIcon
        banner
        style={{ marginBottom: 16 }}
        message={t('season.no_active_season_banner')}
      />
    );
  }

  const selected = seasons.find((s: ISeason) => s.id === selectedSeasonId);
  // `closed_season.can_view` (required to browse a CLOSED season at all —
  // `resolve_season()` in `apps/core/seasons.py`) is held by exactly the
  // same five roles that also hold `season.can_view` (seed_permissions.py
  // RESOURCE_DEFAULTS: admin/director/export_manager/boss via blanket
  // grant, finansist explicitly) — so any role that can legitimately reach
  // this branch already has a working `useSeasons()`. Falling back to the
  // raw id rather than a blank name only matters for the residual gap of a
  // hand-edited permission granting `closed_season.can_view` without
  // `season.can_view` (see `useSeasonReadOnly`'s docstring).
  const displayName = selected?.name ?? (selectedSeasonId != null ? `#${selectedSeasonId}` : '');
  const canSeeArchive = hasArchiveAccess(user);

  return (
    <Alert
      type="warning"
      showIcon
      banner
      style={{ marginBottom: 16 }}
      message={
        <>
          {t('season.readonly_banner', { name: displayName })}
          {!canSeeArchive && <> — {t('season.partial_view_notice')}</>}
        </>
      }
      action={
        <Button size="small" onClick={() => switchSeason(activeId)}>
          {t('season.back_to_active')}
        </Button>
      }
    />
  );
}
