import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { hm } from '../dates';
import { saleWhat } from '../entryText';
import { money, signedMoney } from '../format';
import { saleDiff } from '../lotEntries';
import type { ISale } from '../types';
import { DebtTag } from './DebtTag';

interface ISaleLineProps {
  sale: ISale;
  currency: string;
  /** Buttons after the debt tag (delete, mark paid). */
  actions?: ReactNode;
}

/** A sale row (artifact `saleRow` / `saleText`): «12 ящиков, 80,5 кг», «14:35, 45 ₸ за 1 кг», total, debt tag. */
export function SaleLine({ sale, currency, actions }: ISaleLineProps): ReactElement {
  const { t } = useTranslation();
  const what = saleWhat(sale);

  const price = money(sale.price_kg, currency);
  const diff = saleDiff(sale);
  const sub = [
    hm(sale.sold_at),
    Number(sale.net_kg) > 0 ? t('market.lot.for_kg', { price }) : t('market.lot.for_box', { price }),
    diff !== 0 ? t('market.lot.row_diff', { calc: money(sale.calc_total, currency), off: signedMoney(diff, currency) }) : '',
  ].filter(Boolean).join(', ');
  const debt = sale.paid_on_spot ? null : <DebtTag sale={sale} currency={currency} />;

  return (
    <div className="mk-sale">
      <span className="mk-sale-what">{what}</span>
      <span className="mk-sale-sub">{sub}</span>
      <span className="mk-sale-total mk-num">{money(sale.total, currency)}</span>
      {(debt || actions) && <div className="mk-sale-foot">{debt}{actions}</div>}
    </div>
  );
}
