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

  // ACTIVE is always listed; CLOSED only for roles holding
  // `can_view_closed_seasons`; UPCOMING is always listed too — `resolve_season()`
  // (backend/apps/core/seasons.py) only raises PermissionDenied for a CLOSED
  // season, so any authenticated user can already read `?season=<upcoming id>`.
  // An earlier version of this filter excluded UPCOMING outright on the
  // assumption it always meant "future, empty season" — wrong for a season
  // that was deactivated (is_active=False) without being closed
  // (closed_at=None): that season can hold real, otherwise-unreachable data
  // (see the bug this comment replaces), and hiding it from the switcher was
  // the bug, not a feature.
  const selectable = seasons.filter(
    (s: ISeason) => s.status !== 'CLOSED' || canViewClosed,
  );

  // Nothing to switch BETWEEN, not nothing to show: with 0 or 1 selectable
  // seasons there is no second option a dropdown would offer, so a disabled
  // control would carry no information a user could act on. Hiding it
  // entirely (rather than rendering it disabled) is still correct post-fix.
  if (selectable.length <= 1) return null;

  return (
    <Select<number>
      value={selectedSeasonId ?? undefined}
      onChange={switchSeason}
      style={{ minWidth: 180 }}
      aria-label={t('season.switcher_label')}
      // Never more than a handful of seasons — virtualizing the dropdown
      // buys nothing here and rc-virtual-list's jsdom-unfriendly height
      // measurement (real browsers unaffected) isn't worth the tradeoff.
      virtual={false}
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
