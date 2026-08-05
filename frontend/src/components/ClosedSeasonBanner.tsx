import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useSelectedSeason, useSwitchSeason } from '@/hooks/useSeasonParam';
import { hasArchiveAccess } from '@/utils/permissions';
import type { ISeason } from '@/types';

/**
 * Shown directly above routed content whenever the browsed season is closed.
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

  const selected = seasons.find((s: ISeason) => s.id === selectedSeasonId);
  const activeId = user?.active_season?.id ?? null;
  const canSeeArchive = hasArchiveAccess(user);

  return (
    <Alert
      type="warning"
      showIcon
      banner
      style={{ marginBottom: 16 }}
      message={
        <>
          {t('season.readonly_banner', { name: selected?.name ?? '' })}
          {!canSeeArchive && <> — {t('season.partial_view_notice')}</>}
        </>
      }
      action={
        activeId !== null ? (
          <Button size="small" onClick={() => switchSeason(activeId)}>
            {t('season.back_to_active')}
          </Button>
        ) : undefined
      }
    />
  );
}
