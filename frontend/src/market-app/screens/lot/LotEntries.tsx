import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ROLE, AGENT_SELLER_ROLE } from '@/constants/roles';
import { EntryList } from '../../components/EntryList';
import { showToast } from '../../components/toastStore';
import { entryText } from '../../entryText';
import { useExpenseCategories } from '../../hooks/useExpenseCategories';
import { useDeleteEntry } from '../../hooks/useLotEntries';
import { useMarketMe } from '../../hooks/useMarketMe';
import type { LotEntry } from '../../lotEntries';
import type { ILotDetail } from '../../types';
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
 */
export function LotEntries({ lot }: ILotEntriesProps): ReactElement {
  const { t } = useTranslation();
  const me = useMarketMe();
  const categories = useExpenseCategories();
  const deleteEntry = useDeleteEntry(lot.id);
  const [doomed, setDoomed] = useState<LotEntry | null>(null);
  const categoryLabel = (code: string): string => categories.data?.find((c) => c.code === code)?.label ?? code;

  const canDelete = (e: LotEntry): boolean => {
    if (me.data?.role === AGENT_ROLE) return true;
    return me.data?.role === AGENT_SELLER_ROLE && lot.seller !== null && e.item.created_by === lot.seller.id;
  };

  const remove = (e: LotEntry): void => {
    setDoomed(null);
    deleteEntry.mutateAsync({ kind: e.kind, id: e.item.id }).catch((err: unknown) => {
      showToast({ text: readableError(err) ?? t('market.del.error') });
    });
  };

  const renderActions = (e: LotEntry): ReactElement | null => (canDelete(e) ? (
    <button type="button" className="mk-small mk-small--end" onClick={() => setDoomed(e)}>
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9h20M12 9V5h8v4M9 9l1 18h12l1-18" /></svg>
      {t('market.del.button')}
    </button>
  ) : null);

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
