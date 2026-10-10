import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { money } from '../format';
import type { ISale } from '../types';

interface IDebtTagProps {
  readonly sale: ISale;
  readonly currency: string;
}

/** A debt sale's tag: «Долг: Рустам», «…, осталось 1 500 ₸» once part-paid, «Оплачено» (green) when paid off. */
export function DebtTag({ sale, currency }: IDebtTagProps): ReactElement {
  const { t } = useTranslation();
  if (Number(sale.due) <= 0) return <span className="mk-tag mk-tag--ok">{t('market.lot.paid_tag')}</span>;
  const left = money(sale.due, currency);
  const partPaid = Number(sale.paid_amount) > 0;
  const text = sale.buyer
    ? t(partPaid ? 'market.lot.debt_buyer_left' : 'market.lot.debt_buyer', { name: sale.buyer.name, left })
    : t(partPaid ? 'market.lot.debt_left' : 'market.lot.debt_tag', { left });
  return <span className="mk-tag">{text}</span>;
}
