import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_SELLER_ROLE } from '@/constants/roles';
import { showToast } from '../../components/toastStore';
import { useDeleteEntry, type IDeleteEntryInput } from '../../hooks/useLotEntries';
import { useMarketMe } from '../../hooks/useMarketMe';
import type { ILotDetail } from '../../types';
import { readableError } from './saleBody';
import { SellForm } from './SellForm';

interface ILotFormSlotProps {
  readonly lot: ILotDetail;
}

/**
 * The lot screen's left column: «Машина закрыта» on a closed lot, the sell form for its seller
 * (or «Пусть агент укажет…» while the receipt is missing),
 * nothing for anyone else (Task 9 adds the agent's controls here). /market/me/ carries no user id,
 * but a seller only ever loads his own lots (lots_for), so the seller role is the seller test.
 * Undo stays here because the form unmounts when the sale closes the truck.
 */
export function LotFormSlot({ lot }: ILotFormSlotProps): ReactElement | null {
  const { t } = useTranslation();
  const me = useMarketMe();
  const deleteEntry = useDeleteEntry(lot.id);

  const undo = (entry: IDeleteEntryInput): void => {
    deleteEntry.mutateAsync(entry).catch((err: unknown) => {
      showToast({ text: readableError(err) ?? t('market.sell.undo_error') });
    });
  };

  if (lot.closed_at) {
    return <div className="mk-closed"><p>{t('market.sell.closed')}</p></div>;
  }
  if (me.data?.role !== AGENT_SELLER_ROLE || lot.seller === null) return null;
  // The box count is still a placeholder: no sale until the agent enters the receipt (Task 9).
  if (lot.needs_receipt) {
    return <div className="mk-closed"><p>{t('market.sell.needs_receipt')}</p></div>;
  }
  return <SellForm lot={lot} onUndo={undo} />;
}
