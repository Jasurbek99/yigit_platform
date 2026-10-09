import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { hm } from '../dates';
import { boxes, kg, money } from '../format';
import type { LotEntry } from '../lotEntries';
import { SaleLine } from './SaleLine';

interface IEntryRowProps {
  entry: LotEntry;
  currency: string;
  /** Expense label by category code, for rows saved without their own label. */
  categoryLabel: (code: string) => string;
  /** Buttons for the row's foot (delete, mark paid) — Tasks 8 and C. */
  actions?: ReactNode;
}

/** One sale, spoilage or expense line of the lot (artifact `saleRow`). */
export function EntryRow({ entry, currency, categoryLabel, actions }: IEntryRowProps): ReactElement {
  const { t } = useTranslation();
  const foot = actions ? <div className="mk-sale-foot">{actions}</div> : null;

  if (entry.kind === 'expense') {
    const name = entry.item.label || categoryLabel(entry.item.category_code);
    return (
      <div className="mk-sale mk-sale--cost">
        <span className="mk-sale-what">{t('market.lot.expense_row', { name })}</span>
        <span className="mk-sale-sub">{hm(entry.at)}</span>
        <span className="mk-sale-total mk-num">{`−${money(entry.item.amount, currency)}`}</span>
        {foot}
      </div>
    );
  }
  if (entry.kind === 'spoilage') {
    const s = entry.item;
    const amount = [s.boxes > 0 ? boxes(s.boxes) : '', Number(s.net_kg) > 0 ? t('market.lot.kg_value', { v: kg(s.net_kg) }) : '']
      .filter(Boolean).join(', ');
    return (
      <div className="mk-sale mk-sale--bad">
        <span className="mk-sale-what">{t('market.lot.spoiled_row', { v: amount })}</span>
        <span className="mk-sale-sub">{hm(entry.at)}</span>
        {foot}
      </div>
    );
  }
  return <SaleLine sale={entry.item} currency={currency} actions={actions} />;
}
