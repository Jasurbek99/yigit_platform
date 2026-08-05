import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useSelectedSeason, useSwitchSeason } from '@/hooks/useSeasonParam';
import { hasArchiveAccess } from '@/utils/permissions';
import type { ISeason } from '@/types';

/**
 * Shown directly above routed content whenever nothing is currently writable
 * — either because the browsed season is closed, or because there is no
 * active season at all (the close→open gap).
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
  // permission restriction.
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
  // `useSeasons()` 403s for most operational roles (only admin/director/
  // export_manager/boss hold the `season` resource permission — see
  // useSeasonReadOnly.ts's docstring), so `selected` is reliably `undefined`
  // for e.g. finansist even though they hold `closed_season.can_view` and
  // this banner is their only way back on a pasted link (the switcher
  // self-hides for them too). Falling back to the raw id keeps the message
  // truthful instead of rendering a blank name.
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
