import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { boxes, kg, money, plainMoney, signedMoney } from '../format';
import { formulaDiff } from '../lotEntries';
import type { ILotDetail } from '../types';

interface IStat {
  key: string;
  value: string;
  tone?: 'ok' | 'due' | 'cost' | 'small';
}

interface ILotStatsProps {
  lot: ILotDetail;
}

/** The lot's stats card (artifact `.stats`); optional rows only when they have a value. */
export function LotStats({ lot }: ILotStatsProps): ReactElement {
  const { t } = useTranslation();
  const { totals, currency } = lot;
  const cost = Number(totals.expenses_total);
  const diff = formulaDiff(lot.sales);
  const spoiled = [
    totals.spoiled_boxes > 0 ? boxes(totals.spoiled_boxes) : '',
    Number(totals.spoiled_kg) > 0 ? t('market.lot.kg_value', { v: kg(totals.spoiled_kg) }) : '',
  ].filter(Boolean).join(', ');

  const rows: IStat[] = [{ key: 'sold', value: boxes(totals.sold_boxes) }];
  if (Number(totals.sold_kg) > 0) rows.push({ key: 'net_kg', value: t('market.lot.kg_value', { v: kg(totals.sold_kg) }) });
  rows.push({ key: 'sales', value: money(totals.sales_total, currency) });
  if (cost > 0) {
    rows.push({ key: 'costs', value: `−${money(cost, currency)}`, tone: 'cost' });
    rows.push({ key: 'after', value: plainMoney(totals.after_expenses, currency) });
  }
  rows.push({ key: 'paid', value: money(totals.paid_total, currency), tone: 'ok' });
  rows.push({ key: 'debt', value: money(totals.debt_total, currency), tone: 'due' });
  if (diff !== 0) rows.push({ key: 'diff', value: signedMoney(diff, currency), tone: 'small' });
  if (spoiled) rows.push({ key: 'spoiled', value: spoiled, tone: 'small' });

  return (
    <div className="mk-stats">
      {rows.map((r) => (
        <div key={r.key} className={r.tone ? `mk-stat mk-stat--${r.tone}` : 'mk-stat'}>
          <span>{t(`market.lot.stat_${r.key}`)}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}
