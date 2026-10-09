import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { int } from '../format';

/** Past this many pallets one cell stands for total / 44 boxes. */
const MAX_CELLS = 44;

interface IPalletStyle extends CSSProperties {
  '--p': string;
}

interface ITruckRigProps {
  /** Boxes the truck came with. */
  total: number;
  perPallet: number;
  /** Boxes sold or written off. */
  used: number;
  big?: boolean;
  /** Not tomatoes: green pallets. */
  other?: boolean;
}

/** The truck drawing (artifact `rig`): a cab and a bed of pallets, each filled by the boxes still on it. */
export function TruckRig({ total, perPallet, used, big = false, other = false }: ITruckRigProps): ReactElement {
  const { t } = useTranslation();
  const boxes = Math.max(0, total);
  const per = Math.max(1, perPallet);
  let count = Math.max(1, Math.ceil(boxes / per));
  let cell = per;
  if (count > MAX_CELLS) {
    count = MAX_CELLS;
    cell = boxes / MAX_CELLS;
  }
  const left = Math.max(0, boxes - used);
  const cells = Array.from({ length: count }, (_, i): IPalletStyle => {
    const inCell = Math.max(0, Math.min(cell, left - i * cell));
    return { '--p': `${Math.round((inCell / cell) * 100)}%` };
  });
  const className = `mk-rig${big ? ' mk-rig--big' : ''}${other ? ' mk-rig--other' : ''}`;

  return (
    <div className={className} role="img" aria-label={t('market.lot.left_aria', { left: int(left), total: int(boxes) })}>
      <div className="mk-cab" />
      <div className="mk-bed">
        {cells.map((style, i) => <i key={i} className="mk-pal" style={style} />)}
      </div>
    </div>
  );
}
