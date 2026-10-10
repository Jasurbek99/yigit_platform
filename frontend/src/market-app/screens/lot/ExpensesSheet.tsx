import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/toastStore';
import { money } from '../../format';
import { useExpenseCategories } from '../../hooks/useExpenseCategories';
import type { IDeleteEntryInput } from '../../hooks/useLotEntries';
import type { IExpenseCategory, IExpenseRowInput, IExpensesWrite, ILot } from '../../types';
import {
  amountId, checkCosts, costRows, costsToast, costSum, OTHER_NAME_ID, typedAmount, type ICostForm,
} from './expensesState';
import { sellErrors } from './saleBody';
import { useSubmitLock } from './useSubmitLock';

interface IExpensesSheetProps {
  readonly lot: ILot;
  /** POST …/expenses/ `{rows}` (the create hook lives above the sheet, so its key outlives a close). */
  readonly save: (rows: IExpenseRowInput[]) => Promise<IExpensesWrite>;
  /** Undo deletes every entry of the batch. */
  readonly onUndo: (...entries: IDeleteEntryInput[]) => void;
  readonly onClose: () => void;
}

/** «Расходы по машине»: one amount per cost category, «Другое» with a name, one save (study §3.8). */
export function ExpensesSheet({ lot, save, onUndo, onClose }: IExpensesSheetProps): ReactElement {
  const { t } = useTranslation();
  const categories = useExpenseCategories();
  const rows = costRows(categories.data ?? []);
  const [form, setForm] = useState<ICostForm>({ amounts: {}, otherName: '' });
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmitLock();
  const categoryLabel = (code: string): string => categories.data?.find((c) => c.code === code)?.label ?? code;

  const setAmount = (c: IExpenseCategory, raw: string): void => {
    const next = typedAmount(raw);
    if (next === null) return;
    setForm((f) => ({ ...f, amounts: { ...f.amounts, [c.id]: next } }));
    setError(null);
  };
  const amountInput = (c: IExpenseCategory, label?: string): ReactElement => (
    <input id={amountId(c)} className="mk-field mk-num mk-costrow-amount" type="text" inputMode="decimal"
      autoComplete="off" placeholder="0" aria-label={label} value={form.amounts[c.id] ?? ''}
      onChange={(e) => setAmount(c, e.target.value)} />
  );

  const submit = (): Promise<void> => run(async () => {
    const check = checkCosts(rows, form);
    if (!check.ok) {
      setError(check.error);
      document.getElementById(check.focusId)?.focus();
      return false;
    }
    try {
      const { entries } = await save(check.rows);
      showToast({
        text: costsToast(entries, lot.currency, categoryLabel),
        actionLabel: t('market.sell.undo'),
        onAction: () => onUndo(...entries.map((e): IDeleteEntryInput => ({ kind: 'expense', id: e.id }))),
      });
      onClose();
      return true;
    } catch (err) {
      const errors = sellErrors(err, 'market.lot.maybe_saved');
      setError(errors._ ?? Object.values(errors).find(Boolean) ?? t('market.sell.save_error'));
      return false;
    }
  });

  return (
    <Sheet title={t('market.costs.title')} onClose={onClose}>
      <p className="mk-sheet-text">{lot.shipment.code}</p>
      {categories.isLoading && <p className="mk-hint">{t('market.shell.loading')}</p>}
      {categories.isError && <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>}
      <div className="mk-costrows">
        {rows.named.map((c) => (
          <div className="mk-costrow" key={c.id}>
            <label htmlFor={amountId(c)}>{c.label}</label>
            {amountInput(c)}
          </div>
        ))}
        {rows.other && (
          <div className="mk-costrow">
            <input id={OTHER_NAME_ID} className="mk-field" type="text" maxLength={40} autoComplete="off"
              placeholder={t('market.costs.other')} aria-label={t('market.costs.other')} value={form.otherName}
              onChange={(e) => { setForm((f) => ({ ...f, otherName: e.target.value })); setError(null); }} />
            {amountInput(rows.other, t('market.costs.sum'))}
          </div>
        )}
      </div>
      <div className="mk-costtotal">
        <span>{t('market.costs.total')}</span>
        <b className="mk-num">{money(costSum(rows, form), lot.currency)}</b>
      </div>
      {error && <p className="mk-err" role="alert">{error}</p>}
      <div className="mk-sheet-btns">
        <button type="button" className="mk-btn mk-btn--tomato" disabled={busy || !categories.data}
          onClick={() => void submit()}>
          {t('market.costs.save')}
        </button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </Sheet>
  );
}
