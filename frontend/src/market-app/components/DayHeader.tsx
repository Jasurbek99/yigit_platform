import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { dayLong } from '../dates';
import { kg, money, plainMoney } from '../format';
import { cents, type IDayGroup } from '../lotEntries';

interface IDayHeaderProps {
  day: IDayGroup;
  currency: string;
}

/** One selling day (artifact `dayHead`): the date, money after costs, «Продажи X, расходы Y, Z кг, средняя цена W». */
export function DayHeader({ day, currency }: IDayHeaderProps): ReactElement {
  const { t } = useTranslation();
  const parts = [
    t('market.lot.day_sales', { v: money(day.sales, currency) }),
    day.cost > 0 ? t('market.lot.day_costs', { v: money(day.cost, currency) }) : '',
    day.kg > 0 ? t('market.lot.kg_value', { v: kg(day.kg) }) : '',
    day.kg > 0 && day.sales > 0 ? t('market.lot.day_avg', { v: money(cents(day.sales / day.kg), currency) }) : '',
  ];
  return (
    <div className="mk-day">
      <div className="mk-day-top">
        <span className="mk-day-date">{dayLong(day.at)}</span>
        <span className="mk-day-net mk-num">{plainMoney(cents(day.sales - day.cost), currency)}</span>
      </div>
      <p className="mk-day-sub">{parts.filter(Boolean).join(', ')}</p>
    </div>
  );
}
