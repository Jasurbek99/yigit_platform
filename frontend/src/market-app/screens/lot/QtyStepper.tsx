import type { ChangeEvent, FocusEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaleUnit } from '../../types';
import type { IHint } from './sellFormState';

interface IQtyStepperProps {
  readonly unit: SaleUnit;
  readonly qty: string;
  /** The line under the count; for a whole truck it is the boxed «Всё, что осталось…». */
  readonly hint: IHint | null;
  readonly error?: string;
  /** Digits as typed (the parent caps them). */
  readonly onQty: (qty: string) => void;
  readonly onBump: (delta: number) => void;
  /** Left the field: an empty or zero count goes back to the minimum. */
  readonly onBlur: () => void;
}

const ID = 'mk-sell-qty';

/** `− N +` with 76 px buttons and a 52 px number; a whole truck shows what is left instead. */
export function QtyStepper({ unit, qty, hint, error, onQty, onBump, onBlur }: IQtyStepperProps): ReactElement {
  const { t } = useTranslation();
  if (unit === 'truck') {
    return (
      <div>
        <p className="mk-label">{t('market.sell.how_boxes')}</p>
        <p className="mk-allbox">{hint?.text}</p>
      </div>
    );
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => onQty(e.target.value.replace(/\D/g, '').slice(0, 6));
  const handleFocus = (e: FocusEvent<HTMLInputElement>): void => e.target.select();
  const describedBy = [hint && `${ID}-hint`, error && `${ID}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label className="mk-label" htmlFor={ID}>
        {t(unit === 'pallet' ? 'market.sell.how_pallets' : 'market.sell.how_boxes')}
      </label>
      <div className="mk-step">
        <button type="button" aria-label={t('market.sell.less')} onClick={() => onBump(-1)}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 16h20" /></svg>
        </button>
        <input id={ID} className="mk-num" type="text" inputMode="numeric" autoComplete="off" value={qty}
          aria-invalid={Boolean(error)} aria-describedby={describedBy}
          onChange={handleChange} onFocus={handleFocus} onBlur={onBlur} />
        <button type="button" aria-label={t('market.sell.more')} onClick={() => onBump(1)}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20M6 16h20" /></svg>
        </button>
      </div>
      {error && <p className="mk-err" id={`${ID}-err`}>{error}</p>}
      {hint && <p className={hint.warn ? 'mk-hint mk-hint--warn' : 'mk-hint'} id={`${ID}-hint`}>{hint.text}</p>}
    </div>
  );
}
