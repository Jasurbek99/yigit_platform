import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_SELLER_ROLE } from '@/constants/roles';
import { showToast } from '../../components/toastStore';
import {
  useCreateExpenses, useCreateSpoilage, useDeleteEntry, type IDeleteEntryInput,
} from '../../hooks/useLotEntries';
import { useMarketMe } from '../../hooks/useMarketMe';
import type { ILotDetail } from '../../types';
import { ExpensesSheet } from './ExpensesSheet';
import { ExtraUnits } from './ExtraUnits';
import { readableError } from './saleBody';
import { SellForm } from './SellForm';
import { SlotCard } from './SlotCard';
import { SpoilageSheet } from './SpoilageSheet';

interface ILotFormSlotProps {
  readonly lot: ILotDetail;
}

type OpenSheet = 'spoil' | 'costs' | null;

/**
 * The lot screen's left column: «Машина закрыта» on a closed lot, the sell form for its seller
 * (or «Пусть агент укажет…» while the receipt is missing), nothing for anyone else (Task 9 adds
 * the agent's controls here). /market/me/ carries no user id, but a seller only ever loads his own
 * lots (lots_for), so the seller role is the seller test. The seller keeps «Расходы по машине» on
 * the cards too (the server allows costs on a closed truck).
 * Undo, the sheets and their create hooks stay here: a sale or a write-off that empties the truck
 * swaps the form for the card, and the hooks' Idempotency-Key must outlive a closed sheet.
 */
export function LotFormSlot({ lot }: ILotFormSlotProps): ReactElement {
  const { t } = useTranslation();
  const me = useMarketMe();
  const deleteEntry = useDeleteEntry(lot.id);
  const createSpoilage = useCreateSpoilage(lot.id);
  const createExpenses = useCreateExpenses(lot.id);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const isSeller = me.data?.role === AGENT_SELLER_ROLE && lot.seller !== null;
  const openCosts = (): void => setSheet('costs');
  const close = (): void => setSheet(null);

  /** Delete what a toast's «Отменить» names (an expenses batch is several entries); one toast if any fails. */
  const undo = (...entries: IDeleteEntryInput[]): void => {
    void Promise.allSettled(entries.map((e) => deleteEntry.mutateAsync(e))).then((results) => {
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (!failed) return;
      const fallback = entries[0]?.kind === 'sale' ? 'market.sell.undo_error' : 'market.lot.undo_error';
      showToast({ text: readableError(failed.reason) ?? t(fallback) });
    });
  };

  let body: ReactElement | null = null;
  if (lot.closed_at) {
    body = <SlotCard text={t('market.sell.closed')} onCosts={isSeller ? openCosts : undefined} />;
  } else if (isSeller && lot.needs_receipt) {
    // The box count is still a placeholder: no sale or write-off until the agent enters the receipt (Task 9).
    body = <SlotCard text={t('market.sell.needs_receipt')} onCosts={openCosts} />;
  } else if (isSeller) {
    body = <SellForm lot={lot} onUndo={undo}
      extraUnits={<ExtraUnits onSpoil={() => setSheet('spoil')} onCosts={openCosts} />} />;
  }

  return (
    <>
      {body}
      {sheet === 'spoil' && <SpoilageSheet lot={lot} save={createSpoilage.mutateAsync} onUndo={undo} onClose={close} />}
      {sheet === 'costs' && <ExpensesSheet lot={lot} save={createExpenses.mutateAsync} onUndo={undo} onClose={close} />}
    </>
  );
}
