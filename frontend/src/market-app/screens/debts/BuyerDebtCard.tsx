import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { whenText } from '../../dates';
import { debtSaleWhat } from '../../entryText';
import { money } from '../../format';
import type { IBuyerDebt, IDebtPayment } from '../../types';
import { PaymentRow } from './PaymentRow';

interface IBuyerDebtCardProps {
  readonly debt: IBuyerDebt;
  readonly onPay: () => void;
  readonly onDeletePayment: (payment: IDebtPayment) => void;
}

/**
 * A buyer's card (artifact `.client`): name and due, «Принять оплату», unpaid sales oldest first, recent payments.
 * A paid-off card (due 0, kept 30 days after a payment) says «Долг закрыт» and only lists its payments.
 */
export function BuyerDebtCard({ debt, onPay, onDeletePayment }: IBuyerDebtCardProps): ReactElement {
  const { t } = useTranslation();
  const { currency } = debt;
  const closed = Number(debt.due) === 0;
  return (
    <section className="mk-client">
      <div className="mk-client-top">
        <h2 className="mk-client-name">{debt.buyer.name}</h2>
        <span className="mk-client-sum">{closed ? t('market.debts.closed') : money(debt.due, currency)}</span>
      </div>
      {!closed && (
        <button type="button" className="mk-btn mk-payall" onClick={onPay}>{t('market.debts.pay')}</button>
      )}
      {debt.sales.map((sale) => {
        const partPaid = Number(sale.due) < Number(sale.total);
        const sub = [sale.shipment_code, whenText(sale.sold_at)];
        if (partPaid) sub.push(t('market.debts.of_total', { v: money(sale.total, currency) }));
        return (
          <div className="mk-sale" key={sale.id}>
            <span className="mk-sale-what">{debtSaleWhat(sale)}</span>
            <span className="mk-sale-sub">{sub.join(', ')}</span>
            <span className="mk-sale-total mk-num">{money(sale.due, currency)}</span>
          </div>
        );
      })}
      {debt.payments.length > 0 && (
        <div className="mk-payments">
          <h3 className="mk-payments-title">{t('market.debts.payments')}</h3>
          {debt.payments.map((p) => (
            <PaymentRow key={p.id} payment={p} currency={currency} onDelete={() => onDeletePayment(p)} />
          ))}
        </div>
      )}
    </section>
  );
}
