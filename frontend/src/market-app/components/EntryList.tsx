import { Fragment, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { entryKey, groupByDay, lotEntries, type LotEntry } from '../lotEntries';
import type { ILotDetail } from '../types';
import { DayHeader } from './DayHeader';
import { EntryRow } from './EntryRow';

interface IEntryListProps {
  lot: ILotDetail;
  /** The foot buttons of one entry (Task 8 delete, Part C mark paid). */
  renderActions?: (entry: LotEntry) => ReactNode;
}

/** «Продажи с этой машины»: every entry, newest first, under its day header. */
export function EntryList({ lot, renderActions }: IEntryListProps): ReactElement {
  const { t } = useTranslation();
  const categories = useExpenseCategories();
  const categoryLabel = (code: string): string => categories.data?.find((c) => c.code === code)?.label ?? code;
  const days = groupByDay(lotEntries(lot));

  return (
    <>
      <h2 className="mk-section">{t('market.lot.entries')}</h2>
      {days.length === 0 ? (
        <p className="mk-nosales">{t('market.lot.no_entries')}</p>
      ) : (
        <div className="mk-sales">
          {days.map((day) => (
            <Fragment key={day.key}>
              <DayHeader day={day} currency={lot.currency} />
              {day.entries.map((e) => (
                <EntryRow key={entryKey(e)} entry={e} currency={lot.currency} categoryLabel={categoryLabel}
                  actions={renderActions?.(e)} />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
