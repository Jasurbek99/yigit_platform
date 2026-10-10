import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaleUnit } from '../../types';

interface IUnitPickerProps {
  readonly unit: SaleUnit;
  readonly onChange: (unit: SaleUnit) => void;
  /** Task 8's «Испорчено» / «Расходы по машине» buttons go after the three units. */
  readonly children?: ReactNode;
}

/** The artifact's icons (32 × 32 stroke drawings). */
const PATHS: Readonly<Record<SaleUnit, ReactElement>> = {
  box: <><path d="M4 11l12-6 12 6v11l-12 6-12-6z" /><path d="M4 11l12 6 12-6M16 17v11" /></>,
  pallet: (
    <>
      <rect x="6" y="4" width="9" height="8" /><rect x="17" y="4" width="9" height="8" />
      <rect x="6" y="14" width="9" height="8" /><rect x="17" y="14" width="9" height="8" />
      <path d="M3 25h26M6 25v3M16 25v3M26 25v3" />
    </>
  ),
  truck: (
    <>
      <rect x="2" y="8" width="17" height="13" /><path d="M19 12h5l6 5v4H19z" />
      <circle cx="8" cy="24" r="2.6" /><circle cx="24" cy="24" r="2.6" />
    </>
  ),
};

const UNITS: readonly SaleUnit[] = ['box', 'pallet', 'truck'];

/** «Что продаёте?»: Ящик / Паллета / Вся машина, one pressed. */
export function UnitPicker({ unit, onChange, children }: IUnitPickerProps): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <p className="mk-label mk-label--first" id="mk-sell-what">{t('market.sell.what')}</p>
      <div className="mk-units" role="group" aria-labelledby="mk-sell-what">
        {UNITS.map((u) => (
          <button key={u} type="button" className="mk-unit" aria-pressed={unit === u} onClick={() => onChange(u)}>
            <svg viewBox="0 0 32 32" aria-hidden="true">{PATHS[u]}</svg>
            <span>{t(`market.sell.${u}`)}</span>
          </button>
        ))}
        {children}
      </div>
    </>
  );
}
