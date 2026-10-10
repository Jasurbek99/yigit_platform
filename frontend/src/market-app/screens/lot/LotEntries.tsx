import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ROLE, AGENT_SELLER_ROLE } from '@/constants/roles';
import { EntryList } from '../../components/EntryList';
import { showToast } from '../../components/toastStore';
import { entryText } from '../../entryText';
import { money } from '../../format';
import { useExpenseCategories } from '../../hooks/useExpenseCategories';
import { useDeleteEntry } from '../../hooks/useLotEntries';
import { useMarketMe } from '../../hooks/useMarketMe';
import { useDeletePayment, useMarkPaid } from '../../hooks/usePayments';
import type { LotEntry } from '../../lotEntries';
import type { ILotDetail, ISale } from '../../types';
import { ConfirmDeleteSheet } from './ConfirmDeleteSheet';
import { readableError } from './saleBody';

interface ILotEntriesProps {
  readonly lot: ILotDetail;
}

/**
 * The lot's entry list with «Удалить» on the rows this user may delete (services/entries.py
 * _check_can_delete): the agent on every row; the seller on rows he wrote. /market/me/ has no
 * user id, but a seller only ever loads lots where he is the seller (lots_for), so `lot.seller.id`
 * is his own id and `created_by` (a User pk) is compared with it. The server still has the last word.
 * «Отметить оплату» on a debt sale with a buyer that still owes: the agent and the lot's seller (any author).
 */
export function LotEntries({ lot }: ILotEntriesProps): ReactElement {
  const { t } = useTranslation();
  const me = useMarketMe();
  const categories = useExpenseCategories();
  const deleteEntry = useDeleteEntry(lot.id);
  const markPaid = useMarkPaid();
  const deletePayment = useDeletePayment();
  const [doomed, setDoomed] = useState<LotEntry | null>(null);
  const categoryLabel = (code: string): string => categories.data?.find((c) => c.code === code)?.label ?? code;

  const canDelete = (e: LotEntry): boolean => {
    if (me.data?.role === AGENT_ROLE) return true;
    return me.data?.role === AGENT_SELLER_ROLE && lot.seller !== null && e.item.created_by === lot.seller.id;
  };

  const canMarkPaid = (e: LotEntry): e is Extract<LotEntry, { kind: 'sale' }> => (
    e.kind === 'sale' && !e.item.paid_on_spot && e.item.buyer !== null && Number(e.item.due) > 0
    && (me.data?.role === AGENT_ROLE || me.data?.role === AGENT_SELLER_ROLE)
  );

  // mutateAsync, not per-call callbacks: its promise settles even after the screen is left.
  const undoPayment = (paymentId: number): void => {
    deletePayment.mutateAsync(paymentId).catch((err: unknown) => {
      showToast({ text: readableError(err) ?? t('market.pay.undo_error') });
    });
  };

  const pay = (sale: ISale): void => {
    if (markPaid.isPending) return;
    markPaid.mutateAsync(sale.id).then(({ payment }) => {
      showToast({
        text: t('market.lot.paid_toast', { v: money(payment.amount, payment.currency), name: payment.buyer.name }),
        actionLabel: t('market.sell.undo'),
        onAction: () => undoPayment(payment.id),
      });
    }).catch((err: unknown) => {
      showToast({ text: readableError(err) ?? t('market.lot.mark_paid_error') });
    });
  };

  const remove = (e: LotEntry): void => {
    setDoomed(null);
    deleteEntry.mutateAsync({ kind: e.kind, id: e.item.id }).catch((err: unknown) => {
      showToast({ text: readableError(err) ?? t('market.del.error') });
    });
  };

  const renderActions = (e: LotEntry): ReactElement | null => (!canMarkPaid(e) && !canDelete(e) ? null : (
    <>
      {canMarkPaid(e) && (
        <button type="button" className="mk-small mk-small--ok" disabled={markPaid.isPending} onClick={() => pay(e.item)}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17l6 6L25 9" /></svg>
          {t('market.lot.mark_paid')}
        </button>
      )}
      {canDelete(e) && (
        <button type="button" className="mk-small mk-small--end" onClick={() => setDoomed(e)}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9h20M12 9V5h8v4M9 9l1 18h12l1-18" /></svg>
          {t('market.del.button')}
        </button>
      )}
    </>
  ));

  return (
    <>
      <EntryList lot={lot} renderActions={renderActions} />
      {doomed && (
        <ConfirmDeleteSheet kind={doomed.kind} text={entryText(doomed, lot.currency, categoryLabel)}
          onConfirm={() => remove(doomed)} onClose={() => setDoomed(null)} />
      )}
    </>
  );
}
