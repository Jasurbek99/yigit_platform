import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EntryList } from '../components/EntryList';
import { LeftLine } from '../components/LeftLine';
import { LotStats } from '../components/LotStats';
import { ProductTag, isOtherProduct } from '../components/ProductTag';
import { TruckRig } from '../components/TruckRig';
import { useLot } from '../hooks/useLot';
import { LotFormSlot } from './lot/LotFormSlot';

/** `/lots/:id` — one truck on the bazaar: what is left, the stats and every entry (study §3.4). */
export default function LotScreen(): ReactElement {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const lot = useLot(Number(id));

  if (lot.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }
  if (!lot.data) return <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
  const { shipment, totals } = lot.data;

  return (
    <>
      <div className="mk-bar">
        <Link className="mk-back" to="/">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          {t('market.lot.back')}
        </Link>
      </div>
      <h1 className="mk-title">{shipment.code}</h1>
      {shipment.export_code && <p className="mk-card-sub">{shipment.export_code}</p>}
      <ProductTag product={shipment.product} />
      <TruckRig total={lot.data.boxes_received} perPallet={lot.data.boxes_per_pallet} used={totals.used} big
        other={isOtherProduct(shipment.product)} />
      <LeftLine left={totals.left} total={lot.data.boxes_received} />
      <div className="mk-cols">
        {/* Left column: the sell form or the «closed» card; Task 9's agent controls go here too. */}
        <section className="mk-lot-form" data-slot="lot-form"><LotFormSlot lot={lot.data} /></section>
        <div>
          <LotStats lot={lot.data} />
          <EntryList lot={lot.data} />
        </div>
      </div>
    </>
  );
}
