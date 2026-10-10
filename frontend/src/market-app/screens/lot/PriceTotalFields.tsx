import { useState, type ChangeEvent, type FocusEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { currencySign, groupThousands } from '../../format';

interface IPriceTotalFieldsProps {
  readonly currency: string;
  readonly price: string;
  readonly onPrice: (price: string) => void;
  readonly total: string;
  readonly totalTouched: boolean;
  /** net × price as typed text ("4 500"), '' while it cannot be worked out. */
  readonly calcText: string;
  /** Typed total; '' gives the field back to the formula. */
  readonly onTotal: (total: string) => void;
  /** Focus on an untouched total: freeze the formula's value so it can be edited. */
  readonly onTotalFocus: () => void;
  /** «По формуле: X. Разница: +Y». */
  readonly totalHint: string | null;
  readonly priceError?: string;
  readonly totalError?: string;
}

const PRICE_ID = 'mk-sell-price';
const TOTAL_ID = 'mk-sell-total';

/** «Цена за 1 кг» and «Итого (можно исправить)», side by side on a wide form. */
export function PriceTotalFields(props: IPriceTotalFieldsProps): ReactElement {
  const { currency, price, onPrice, total, totalTouched, calcText, onTotal, onTotalFocus, totalHint } = props;
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const sign = currencySign(currency);
  const shownTotal = totalTouched || focused ? total : calcText;

  const handlePrice = (e: ChangeEvent<HTMLInputElement>): void => onPrice(groupThousands(e.target.value, 2));
  const handleTotal = (e: ChangeEvent<HTMLInputElement>): void => onTotal(groupThousands(e.target.value, 2));
  const handleFocus = (e: FocusEvent<HTMLInputElement>): void => {
    setFocused(true);
    onTotalFocus();
    e.target.select();
  };

  return (
    <div className="mk-pair">
      <div>
        <Field id={PRICE_ID} label={t('market.sell.price', { sign })} error={props.priceError}>
          {(p) => (
            <input {...p} className={`${p.className} mk-field--num mk-num`} type="text" inputMode="decimal"
              autoComplete="off" placeholder="0" value={price} onChange={handlePrice} />
          )}
        </Field>
      </div>
      <div>
        <Field id={TOTAL_ID} label={t('market.sell.total', { sign })} error={props.totalError}>
          {(p) => (
            <input {...p} className={`${p.className} mk-field--num mk-num`} type="text" inputMode="decimal"
              autoComplete="off" placeholder="0" value={shownTotal} onChange={handleTotal} onFocus={handleFocus}
              onBlur={() => setFocused(false)}
              aria-describedby={p['aria-describedby'] ?? (totalHint ? `${TOTAL_ID}-hint` : undefined)} />
          )}
        </Field>
        {totalHint && <p className="mk-hint" id={`${TOTAL_ID}-hint`}>{totalHint}</p>}
      </div>
    </div>
  );
}
