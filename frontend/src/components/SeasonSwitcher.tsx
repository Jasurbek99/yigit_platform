import { Select, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSelectedSeason, useSwitchSeason } from '@/hooks/useSeasonParam';
import type { ISeason, SeasonStatus } from '@/types';

const STATUS_KEY: Record<SeasonStatus, string> = {
  ACTIVE: 'season.status_active',
  CLOSED: 'season.status_closed',
  UPCOMING: 'season.status_upcoming',
};

const STATUS_COLOR: Record<SeasonStatus, string> = {
  ACTIVE: 'green',
  CLOSED: 'default',
  UPCOMING: 'blue',
};

/**
 * Header season picker. Hidden when there is nothing to switch between —
 * only one selectable season (the common case: just the active one).
 *
 * Reads the current selection via `useSelectedSeason()` (URL ?? store ??
 * active), not the raw `useSeasonStore` value — see that hook's docstring.
 * Switches via `useSwitchSeason()`, which updates the store and the URL
 * together so a switch back to the active season never leaves a stale
 * `?season=` behind for a render (see that hook's docstring).
 */
export function SeasonSwitcher(): JSX.Element | null {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: seasons = [] } = useSeasons();
  const { seasonId: selectedSeasonId } = useSelectedSeason();
  const switchSeason = useSwitchSeason();

  const canViewClosed = user?.can_view_closed_seasons ?? false;

  // Upcoming seasons are never listed — there is nothing in them to show.
  const selectable = seasons.filter(
    (s: ISeason) => s.status === 'ACTIVE' || (s.status === 'CLOSED' && canViewClosed),
  );

  if (selectable.length <= 1) return null;

  return (
    <Select<number>
      value={selectedSeasonId ?? undefined}
      onChange={switchSeason}
      style={{ minWidth: 180 }}
      aria-label={t('season.switcher_label')}
      options={selectable.map((s: ISeason) => ({
        value: s.id,
        label: (
          <span>
            {s.name}{' '}
            {s.status !== 'ACTIVE' && (
              <Tag color={STATUS_COLOR[s.status]}>{t(STATUS_KEY[s.status])}</Tag>
            )}
          </span>
        ),
      }))}
    />
  );
}
