import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { currencySign, groupThousands } from '../../format';
import { useUpdateLot } from '../../hooks/useLot';
import type { ILot } from '../../types';
import {
  checkReceipt, receiptBody, receiptErrors, receiptForm, type IReceiptForm, type ReceiptErrors,
} from './receiptState';
import { useSubmitLock } from './useSubmitLock';

interface IReceiptSheetProps {
  readonly lot: ILot;
  readonly onClose: () => void;
}

/** A digit-only field: its typed key, the API field (also its label key) and max length. */
interface ICountField {
  id: string;
  key: 'boxes' | 'perPallet' | 'tare';
  field: 'boxes_received' | 'boxes_per_pallet' | 'tare_g';
  max: number;
}

const COUNTS: readonly ICountField[] = [
  { id: 'mk-receipt-boxes', key: 'boxes', field: 'boxes_received', max: 6 },
  { id: 'mk-receipt-pallet', key: 'perPallet', field: 'boxes_per_pallet', max: 4 },
  { id: 'mk-receipt-tare', key: 'tare', field: 'tare_g', max: 5 },
];

/** «Приёмка»: how many boxes came, boxes per pallet, empty-box weight and the price that prefills a sale. */
export function ReceiptSheet({ lot, onClose }: IReceiptSheetProps): ReactElement {
  const { t } = useTranslation();
  const update = useUpdateLot(lot.id);
  const lock = useSubmitLock();
  const [form, setForm] = useState<IReceiptForm>(() => receiptForm(lot));
  const [errors, setErrors] = useState<ReceiptErrors>({});

  const set = (key: keyof IReceiptForm, value: string): void => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const missing = checkReceipt(form);
    if (missing) {
      setErrors(missing);
      return;
    }
    const body = receiptBody(form, lot);
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void lock.run(async () => {
      try {
        await update.mutateAsync(body);
        onClose();
        return true;
      } catch (err) {
        setErrors(receiptErrors(err, body.boxes_received !== undefined));
        return false;
      }
    });
  };

  return (
    <Sheet title={t('market.agent.receipt')} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {COUNTS.map((c, i) => (
          <Field key={c.id} id={c.id} label={t(`market.agent.${c.field}`)} error={errors[c.field]} first={i === 0}>
            {(p) => (
              <input {...p} className={`${p.className} mk-num`} type="text" inputMode="numeric" autoComplete="off"
                maxLength={c.max} value={form[c.key]}
                onChange={(e) => set(c.key, e.target.value.replace(/\D/g, '').slice(0, c.max))} />
            )}
          </Field>
        ))}
        <Field id="mk-receipt-price" label={t('market.agent.default_price', { sign: currencySign(lot.currency) })}
          error={errors.default_price_kg}>
          {(p) => (
            <input {...p} className={`${p.className} mk-num`} type="text" inputMode="decimal" autoComplete="off"
              value={form.price} onChange={(e) => set('price', groupThousands(e.target.value, 2))} />
          )}
        </Field>
        <p className="mk-hint">{t('market.agent.price_hint')}</p>
        <SheetButtons busy={lock.busy} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}
