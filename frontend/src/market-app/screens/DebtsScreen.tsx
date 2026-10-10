import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../components/toastStore';
import { dayShort } from '../dates';
import { money } from '../format';
import { useDebts } from '../hooks/useDebts';
import { useCreatePayment, useDeletePayment } from '../hooks/usePayments';
import type { IBuyerDebt, IDebtPayment } from '../types';
import { BuyerDebtCard } from './debts/BuyerDebtCard';
import { PaymentSheet } from './debts/PaymentSheet';
import { ConfirmDeleteSheet } from './lot/ConfirmDeleteSheet';
import { readableError } from './lot/saleBody';

type OpenSheet =
  | { kind: 'pay'; debt: IBuyerDebt }
  | { kind: 'delete'; debt: IBuyerDebt; payment: IDebtPayment }
  | null;

/**
 * «Долги клиентов» (study §3.10): the total per currency, a card per buyer and currency.
 * Delete is offered on every payment: the server allows its author or the agent and
 * answers anyone else with a 403, which shows in a toast.
 */
export default function DebtsScreen(): ReactElement {
  const { t } = useTranslation();
  const debts = useDebts();
  const createPayment = useCreatePayment();
  const deletePayment = useDeletePayment();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const handleClose = (): void => setSheet(null);

  const removePayment = (id: number, fallbackKey: string): void => {
    deletePayment.mutate(id, { onError: (err) => showToast({ text: readableError(err) ?? t(fallbackKey) }) });
  };

  if (debts.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }
  if (!debts.data) return <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
  const { totals, buyers } = debts.data;

  return (
    <>
      <h1 className="mk-title">{t('market.debts.title')}</h1>
      {buyers.length === 0 ? (
        <div className="mk-empty">
          <h2 className="mk-empty-title">{t('market.debts.none')}</h2>
          <p className="mk-empty-text">{t('market.debts.empty_text')}</p>
        </div>
      ) : (
        <>
          <p className="mk-duelabel">{t('market.debts.total')}</p>
          {Object.entries(totals).map(([currency, due]) => (
            <p key={currency} className="mk-bigdue">{money(due, currency)}</p>
          ))}
          <div className="mk-clients">
            {buyers.map((debt) => (
              <BuyerDebtCard key={`${debt.buyer.id}-${debt.currency}`} debt={debt}
                onPay={() => setSheet({ kind: 'pay', debt })}
                onDeletePayment={(payment) => setSheet({ kind: 'delete', debt, payment })} />
            ))}
          </div>
        </>
      )}
      {sheet?.kind === 'pay' && (
        <PaymentSheet debt={sheet.debt} save={createPayment.mutateAsync}
          onUndo={(id) => removePayment(id, 'market.pay.undo_error')} onClose={handleClose} />
      )}
      {sheet?.kind === 'delete' && (
        <ConfirmDeleteSheet
          title={t('market.debts.delete_q')}
          text={t('market.debts.delete_text', {
            sum: money(sheet.payment.amount, sheet.debt.currency),
            date: dayShort(sheet.payment.paid_at),
            name: sheet.debt.buyer.name,
          })}
          onConfirm={() => {
            removePayment(sheet.payment.id, 'market.debts.delete_error');
            handleClose();
          }}
          onClose={handleClose}
        />
      )}
    </>
  );
}
