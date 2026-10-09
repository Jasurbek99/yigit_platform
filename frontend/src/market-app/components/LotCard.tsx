import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { dayShort } from '../dates';
import { kg, money } from '../format';
import type { ILot } from '../types';
import { LeftLine } from './LeftLine';
import { ProductTag, isOtherProduct } from './ProductTag';
import { TruckRig } from './TruckRig';

interface ILotCardProps {
  lot: ILot;
  /** The agent sees whose lot it is; the seller knows. */
  showSeller: boolean;
}

/** An open truck on the home screen (artifact `.truck`); the whole card opens the lot. */
export function LotCard({ lot, showSeller }: ILotCardProps): ReactElement {
  const { t } = useTranslation();
  const { totals, currency, shipment } = lot;
  const paid = Number(totals.paid_total);
  const debt = Number(totals.debt_total);
  const spoiled = [
    totals.spoiled_boxes > 0 ? t('market.fmt.boxes', { count: totals.spoiled_boxes }) : '',
    Number(totals.spoiled_kg) > 0 ? t('market.lot.kg_value', { v: kg(totals.spoiled_kg) }) : '',
  ].filter(Boolean).join(', ');

  return (
    <Link className="mk-truck" to={`/lots/${lot.id}`}>
      <span className="mk-truck-top">
        <span className="mk-truck-name">{shipment.code}</span>
        <span className="mk-truck-date">{dayShort(lot.opened_at)}</span>
      </span>
      {shipment.export_code && <span className="mk-truck-sub">{shipment.export_code}</span>}
      <ProductTag product={shipment.product} />
      {showSeller && lot.seller && <span className="mk-truck-sub">{lot.seller.name}</span>}
      <TruckRig total={lot.boxes_received} perPallet={lot.boxes_per_pallet} used={totals.used}
        other={isOtherProduct(shipment.product)} />
      <LeftLine left={totals.left} total={lot.boxes_received} />
      {(paid > 0 || debt > 0) && (
        <span className="mk-moneyline">
          {paid > 0 && <span className="mk-ok">{t('market.home.paid_sum', { v: money(paid, currency) })}</span>}
          {debt > 0 && <span className="mk-due">{t('market.home.due_sum', { v: money(debt, currency) })}</span>}
        </span>
      )}
      {Number(totals.expenses_total) > 0 && (
        <span className="mk-badline">{t('market.home.cost_line', { v: money(totals.expenses_total, currency) })}</span>
      )}
      {spoiled && <span className="mk-badline">{t('market.home.spoiled_line', { v: spoiled })}</span>}
    </Link>
  );
}
