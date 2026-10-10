import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ROLE, AGENT_SELLER_ROLE } from '@/constants/roles';
import { showToast } from '../../components/toastStore';
import {
  useCreateExpenses, useCreateSpoilage, useDeleteEntry, type IDeleteEntryInput,
} from '../../hooks/useLotEntries';
import { useMarketMe } from '../../hooks/useMarketMe';
import type { ILotDetail } from '../../types';
import { AgentLotControls } from './AgentLotControls';
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
 * (or «Машина ещё в пути…» before destination customs, «Пусть агент укажет…» while the receipt
 * is missing), the receipt / seller controls for the
 * agent (under the closed card too), nothing for staff. /market/me/ carries no user id, but a seller only ever loads his own
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
  const isAgent = me.data?.role === AGENT_ROLE;
  const openCosts = (): void => setSheet('costs');
  const close = (): void => setSheet(null);

  /**
   * Delete what a toast's «Отменить» names (an expenses batch is several entries), one at a time:
   * each answer's lot totals overwrite the cached detail, so a late answer from a parallel delete
   * would leave stale totals. One toast if any delete fails.
   */
  const undo = async (...entries: IDeleteEntryInput[]): Promise<void> => {
    let failure: unknown = null;
    for (const e of entries) {
      try {
        await deleteEntry.mutateAsync(e);
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure === null) return;
    const fallback = entries[0]?.kind === 'sale' ? 'market.sell.undo_error' : 'market.lot.undo_error';
    showToast({ text: readableError(failure) ?? t(fallback) });
  };
  const undoNow = (...entries: IDeleteEntryInput[]): void => {
    void undo(...entries);
  };

  let body: ReactElement | null = null;
  if (lot.closed_at) {
    body = <SlotCard text={t('market.sell.closed')} onCosts={isSeller ? openCosts : undefined} />;
  } else if (isSeller && lot.on_the_road) {
    // The server refuses a sale or a write-off before destination customs; costs are allowed.
    body = <SlotCard text={t('market.sell.on_the_road')} onCosts={openCosts} />;
  } else if (isSeller && lot.needs_receipt) {
    // The box count is still a placeholder: no sale or write-off until the agent enters the receipt.
    body = <SlotCard text={t('market.sell.needs_receipt')} onCosts={openCosts} />;
  } else if (isSeller) {
    body = <SellForm lot={lot} onUndo={undoNow}
      extraUnits={<ExtraUnits onSpoil={() => setSheet('spoil')} onCosts={openCosts} />} />;
  }

  return (
    <>
      {body}
      {isAgent && <AgentLotControls lot={lot} />}
      {sheet === 'spoil' && <SpoilageSheet lot={lot} save={createSpoilage.mutateAsync} onUndo={undoNow} onClose={close} />}
      {sheet === 'costs' && <ExpensesSheet lot={lot} save={createExpenses.mutateAsync} onUndo={undoNow} onClose={close} />}
    </>
  );
}
