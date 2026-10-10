import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/toastStore';
import { groupThousands, inputNumber, money } from '../../format';
import type { IBuyerDebt, IPaymentInput, IPaymentWrite } from '../../types';
import { sellErrors } from '../lot/saleBody';
import { useSubmitLock } from '../lot/useSubmitLock';
import { payHint, paymentBody } from './paymentState';

interface IPaymentSheetProps {
  readonly debt: IBuyerDebt;
  /** POST /market/payments/ (the hook lives above the sheet, so its key outlives a close). */
  readonly save: (body: IPaymentInput) => Promise<IPaymentWrite>;
  /** The toast's «Отменить»: deletes the payment just recorded. */
  readonly onUndo: (paymentId: number) => void;
  readonly onClose: () => void;
}

const AMOUNT_ID = 'mk-pay-amount';

/** «Оплата: <имя>»: the amount prefilled with the whole due, a live hint, save → toast with undo (study §3.10). */
export function PaymentSheet({ debt, save, onUndo, onClose }: IPaymentSheetProps): ReactElement {
  const { t } = useTranslation();
  const due = Number(debt.due);
  const [raw, setRaw] = useState(() => inputNumber(debt.due));
  const [bad, setBad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmitLock();
  const hint = payHint(raw, due, debt.currency);

  const submit = (): Promise<void> => run(async () => {
    const body = paymentBody(debt.buyer.id, debt.currency, raw, due);
    if (!body) {
      setBad(true);
      document.getElementById(AMOUNT_ID)?.focus();
      return false;
    }
    try {
      // The server caps the amount at the due: the toast says what it recorded.
      const { payment } = await save(body);
      showToast({
        text: t('market.pay.saved', { v: money(payment.amount, payment.currency), name: debt.buyer.name }),
        actionLabel: t('market.sell.undo'),
        onAction: () => onUndo(payment.id),
      });
      onClose();
      return true;
    } catch (err) {
      const errors = sellErrors(err, 'market.pay.maybe_saved');
      setError(errors._ ?? Object.values(errors).find(Boolean) ?? t('market.sell.save_error'));
      return false;
    }
  });

  return (
    <Sheet title={t('market.pay.title', { name: debt.buyer.name })} onClose={onClose}>
      <p className="mk-sheet-text">{t('market.pay.owes', { v: money(debt.due, debt.currency) })}</p>
      <label className="mk-label" htmlFor={AMOUNT_ID}>{t('market.pay.how_much')}</label>
      <input id={AMOUNT_ID} className={bad ? 'mk-field mk-field--num mk-num mk-field--bad' : 'mk-field mk-field--num mk-num'}
        type="text" inputMode="decimal" autoComplete="off" value={raw} aria-invalid={bad}
        onFocus={(e) => e.target.select()}
        onChange={(e) => { setRaw(groupThousands(e.target.value, 2)); setBad(false); setError(null); }} />
      <p className={hint.warn ? 'mk-hint mk-hint--warn' : 'mk-hint'}>{hint.text}</p>
      {error && <p className="mk-err" role="alert">{error}</p>}
      <div className="mk-sheet-btns">
        <button type="button" className="mk-btn mk-btn--tomato" disabled={busy} onClick={() => void submit()}>
          {t('market.pay.save')}
        </button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </Sheet>
  );
}
