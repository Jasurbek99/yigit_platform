import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isOtherProduct } from '../../components/ProductTag';
import { dayShort } from '../../dates';
import { boxes, kg, money } from '../../format';
import type { ILot } from '../../types';

interface IClosedLotsListProps {
  lots: ILot[];
}

function closedTime(lot: ILot): number {
  return Date.parse(lot.closed_at ?? lot.opened_at);
}

/** «Закрытые машины»: compact rows, last closed first (artifact `.done`). */
export function ClosedLotsList({ lots }: IClosedLotsListProps): ReactElement | null {
  const { t } = useTranslation();
  if (lots.length === 0) return null;
  const sorted = [...lots].sort((a, b) => closedTime(b) - closedTime(a));

  return (
    <>
      <h2 className="mk-section">{t('market.home.closed')}</h2>
      <div>
        {sorted.map((lot) => {
          const { totals, shipment, currency } = lot;
          const name = isOtherProduct(shipment.product) ? `${shipment.code}, ${shipment.product.name_ru}` : shipment.code;
          const sub = [
            t('market.home.closed_on', { date: dayShort(lot.closed_at ?? lot.opened_at) }),
            boxes(totals.sold_boxes),
            Number(totals.sold_kg) > 0 ? t('market.lot.kg_value', { v: kg(totals.sold_kg) }) : '',
          ].filter(Boolean).join(', ');
          return (
            <Link key={lot.id} className="mk-done" to={`/lots/${lot.id}`}>
              <span className="mk-done-name">{name}</span>
              <span className="mk-done-sub">{sub}</span>
              <span className="mk-done-money mk-num">
                {money(totals.sales_total, currency)}
                {Number(totals.debt_total) > 0 && (
                  <span className="mk-done-due">{t('market.home.due_sum', { v: money(totals.debt_total, currency) })}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
