import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { boxes, kg, money } from '../../format';
import { useCreateBuyer } from '../../hooks/useBuyers';
import { useCreateSale, type IDeleteEntryInput } from '../../hooks/useLotEntries';
import { showToast } from '../../components/toastStore';
import { saleBody, sellErrors, type SellErrors } from './saleBody';
import type { ISellForm } from './sellFormState';

/** Save is locked this long after a sale (artifact `form.cool`), so a double tap never sells twice. */
export const COOLDOWN_MS = 700;

export type SaveResult = { status: 'saved' } | { status: 'busy' } | { status: 'failed'; errors: SellErrors };

export interface ISaveSale {
  /** Locked from the press until 700 ms after the answer (or until a failure). */
  busy: boolean;
  save: (form: ISellForm) => Promise<SaveResult>;
}

/**
 * Posts a checked form: the debt buyer first (get-or-create by name), then the sale; on success
 * the toast «Сохранено: …» with «Отменить». The lock is a ref as well as state: the Idempotency-Key
 * is read at render, so a second press before the re-render must not fire a second create.
 */
export function useSaveSale(lotId: number, onUndo: (entry: IDeleteEntryInput) => void): ISaveSale {
  const { t } = useTranslation();
  const createSale = useCreateSale(lotId);
  const createBuyer = useCreateBuyer();
  const lock = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const release = (): void => {
    lock.current = false;
    setBusy(false);
  };

  const save = async (form: ISellForm): Promise<SaveResult> => {
    if (lock.current) return { status: 'busy' };
    lock.current = true;
    setBusy(true);
    try {
      const buyerId = form.paid ? undefined : (await createBuyer.mutateAsync({ name: form.buyer.trim() })).id;
      const { entry, lot } = await createSale.mutateAsync(saleBody(form, buyerId));
      const params = { boxes: boxes(entry.boxes), kg: kg(entry.net_kg), total: money(entry.total, lot.currency) };
      showToast({
        text: t(lot.closed_at ? 'market.sell.saved_closed' : 'market.sell.saved', params),
        actionLabel: t('market.sell.undo'),
        onAction: () => onUndo({ kind: 'sale', id: entry.id }),
      });
      timer.current = window.setTimeout(release, COOLDOWN_MS);
      return { status: 'saved' };
    } catch (err) {
      release();
      return { status: 'failed', errors: sellErrors(err, t('market.sell.save_error')) };
    }
  };

  return { busy, save };
}
