import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { int } from '../format';

interface ILeftLineProps {
  /** Boxes left; negative when more was sold than the truck had. */
  left: number;
  total: number;
}

/** «90 ящиков осталось из 100», or amber «5 ящиков продано больше, чем было в машине» (artifact `leftLine`). */
export function LeftLine({ left, total }: ILeftLineProps): ReactElement {
  const { t } = useTranslation();
  if (left < 0) {
    return (
      <p className="mk-leftline mk-leftline--over">
        <b>{int(-left)}</b>{' '}{t('market.lot.over', { count: -left })}
      </p>
    );
  }
  return (
    <p className="mk-leftline">
      <b>{int(left)}</b>{' '}{t('market.lot.left_of', { count: left, total: int(total) })}
    </p>
  );
}
