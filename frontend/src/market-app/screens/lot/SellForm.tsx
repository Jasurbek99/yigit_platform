import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { inputNumber } from '../../format';
import type { IDeleteEntryInput } from '../../hooks/useLotEntries';
import type { ILotDetail, SaleUnit } from '../../types';
import { BuyerField } from './BuyerField';
import { PayToggle } from './PayToggle';
import { PriceTotalFields } from './PriceTotalFields';
import { QtyStepper } from './QtyStepper';
import { checkSale, type SellErrors, type SellField } from './saleBody';
import {
  calcTotal, canSave, clampQty, firstPrice, netHint, newForm, qtyHint, stockOf, totalHint, type ISellForm,
} from './sellFormState';
import { UnitPicker } from './UnitPicker';
import { useSaveSale } from './useSaveSale';
import { WeightField } from './WeightField';

interface ISellFormProps {
  readonly lot: ILotDetail;
  /** Undo from the toast; lives above the form, which is gone once the sale closes the truck. */
  readonly onUndo: (entry: IDeleteEntryInput) => void;
  /** Task 8's «Испорчено» / «Расходы по машине» buttons, shown after the units. */
  readonly extraUnits?: ReactNode;
}

/** Where a failed check sends the focus. */
const FIELD_IDS: Readonly<Record<SellField, string>> = {
  qty: 'mk-sell-qty', gross_kg: 'mk-sell-kg', price_kg: 'mk-sell-price', total: 'mk-sell-total', buyer_id: 'mk-sell-buyer',
};

/** The sell form on the lot screen (study §3.5): unit, count, scale weight, price, total, paid / debt, save. */
export function SellForm({ lot, onUndo, extraUnits }: ISellFormProps): ReactElement {
  const { t } = useTranslation();
  const stock = stockOf(lot);
  const [form, setForm] = useState<ISellForm>(() => newForm(firstPrice(lot)));
  const [errors, setErrors] = useState<SellErrors>({});
  const { busy, save } = useSaveSale(lot.id, onUndo);
  const calc = calcTotal(form, stock);
  const calcText = calc > 0 ? inputNumber(calc) : '';

  /** Apply a change and drop the errors it answers (and the form-level line). */
  const change = (patch: Partial<ISellForm>, ...fields: SellField[]): void => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e, _: undefined };
      fields.forEach((k) => { next[k] = undefined; });
      return next;
    });
  };
  const setUnit = (unit: SaleUnit): void => change({ unit, ...clampQty(unit, form.qty || '1', stock) }, 'qty');
  const setQty = (qty: string): void => change(clampQty(form.unit, qty, stock), 'qty');
  const bump = (delta: number): void => setQty(String(Math.max(1, (Number(form.qty) || 0) + delta)));
  const fixQty = (): void => {
    if (!(Number(form.qty) >= 1)) change({ qty: '1', capped: false });
  };

  const handleSave = async (): Promise<void> => {
    const bad = checkSale(form, stock);
    if (bad) {
      setErrors(bad);
      const first = Object.keys(FIELD_IDS).find((k): k is SellField => k in bad);
      if (first) document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    const result = await save(form);
    if (result.status === 'saved') {
      setForm((f) => newForm(f.price));
      setErrors({});
    } else if (result.status === 'failed') {
      setErrors(result.errors);
    }
  };

  return (
    <div className="mk-sell">
      <UnitPicker unit={form.unit} onChange={setUnit}>{extraUnits}</UnitPicker>
      <div className="mk-pair">
        <QtyStepper unit={form.unit} qty={form.qty} hint={qtyHint(form, stock)} error={errors.qty}
          onQty={setQty} onBump={bump} onBlur={fixQty} />
        <WeightField value={form.gross} onChange={(gross) => change({ gross }, 'gross_kg')}
          hint={netHint(form, stock)} error={errors.gross_kg} />
      </div>
      <PriceTotalFields currency={lot.currency} price={form.price} onPrice={(price) => change({ price }, 'price_kg')}
        total={form.total} totalTouched={form.totalTouched} calcText={calcText}
        onTotal={(total) => change({ total, totalTouched: total.trim() !== '' }, 'total')}
        onTotalFocus={() => setForm((f) => (f.totalTouched ? f : { ...f, total: calcText }))}
        totalHint={totalHint(form, stock, lot.currency)} priceError={errors.price_kg} totalError={errors.total} />
      <PayToggle paid={form.paid} onChange={(paid) => change({ paid }, 'buyer_id')} />
      {!form.paid && (
        <BuyerField value={form.buyer} onChange={(buyer) => change({ buyer }, 'buyer_id')} error={errors.buyer_id} />
      )}
      {errors._ && <p className="mk-err" role="alert">{errors._}</p>}
      <button type="button" className="mk-btn mk-btn--tomato mk-save" disabled={busy || !canSave(form, stock)}
        onClick={() => void handleSave()}>
        {t('market.sell.save')}
      </button>
    </div>
  );
}
