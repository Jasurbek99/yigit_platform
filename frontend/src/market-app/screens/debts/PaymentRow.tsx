import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort } from '../../dates';
import { money } from '../../format';
import type { IDebtPayment } from '../../types';

interface IPaymentRowProps {
  readonly payment: IDebtPayment;
  readonly currency: string;
  /** Opens the delete confirmation; the server allows the author or the agent. */
  readonly onDelete: () => void;
}

/** One recent payment of a buyer: «5 000 ₸, 12 окт.» and «Удалить». */
export function PaymentRow({ payment, currency, onDelete }: IPaymentRowProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mk-payrow">
      <span>{t('market.debts.payment_row', { sum: money(payment.amount, currency), date: dayShort(payment.paid_at) })}</span>
      <button type="button" className="mk-small mk-small--danger" onClick={onDelete}>{t('market.del.button')}</button>
    </div>
  );
}
