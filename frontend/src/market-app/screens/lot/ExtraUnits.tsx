import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface IExtraUnitsProps {
  readonly onSpoil: () => void;
  readonly onCosts: () => void;
}

/** After the sale units: «Испорчено» (amber) and the full-width «Расходы по машине» (red). They open sheets. */
export function ExtraUnits({ onSpoil, onCosts }: IExtraUnitsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" className="mk-unit mk-unit--bad" onClick={onSpoil}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9h20M12 9V5h8v4M9 9l1 18h12l1-18" /></svg>
        <span>{t('market.spoil.button')}</span>
      </button>
      <button type="button" className="mk-unit mk-unit--cost" onClick={onCosts}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" /><path d="M11 16h10" /></svg>
        <span>{t('market.costs.button')}</span>
      </button>
    </>
  );
}
