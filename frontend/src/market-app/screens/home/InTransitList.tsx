import type { ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { drfFieldErrors } from '@/utils/drfErrors';
import { ProductTag } from '../../components/ProductTag';
import { showToast } from '../../components/toastStore';
import { useOpenLot } from '../../hooks/useLots';
import { useMarketShipments } from '../../hooks/useMarketShipments';

/**
 * Agent only (the endpoint refuses sellers): the customer's trucks on the road or arrived that
 * have no lot yet, arrived first as the API sends them. «Открыть» opens the lot and goes to it.
 */
interface IInTransitListProps {
  /** Shown instead when no truck is waiting to be opened (the empty state when there are no lots either). */
  fallback?: ReactNode;
}

export function InTransitList({ fallback = null }: IInTransitListProps): ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shipments = useMarketShipments();
  const openLot = useOpenLot();
  const pending = (shipments.data ?? []).filter((s) => s.lot_id === null);
  if (shipments.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }
  // A failed request is not «no trucks»: say so, never the empty state.
  if (shipments.isError) return <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
  if (pending.length === 0) return <>{fallback}</>;

  const handleOpen = (shipmentId: number): void => {
    openLot.mutate({ shipment_id: shipmentId }, {
      onSuccess: (lot) => navigate(`/lots/${lot.id}`),
      onError: (err) => showToast({ text: drfFieldErrors(err)?.error?.[0] ?? t('market.home.open_error') }),
    });
  };

  return (
    <>
      <h2 className="mk-section">{t('market.home.in_transit')}</h2>
      <div>
        {pending.map((s) => (
          <div key={s.id} className="mk-road">
            <span className="mk-done-name">{s.code}</span>
            {s.export_code && <span className="mk-done-sub">{s.export_code}</span>}
            {s.status_code && <span className="mk-done-sub">{t(`shipment_status.${s.status_code}`)}</span>}
            <ProductTag product={s.product} />
            <button type="button" className="mk-small" disabled={openLot.isPending} onClick={() => handleOpen(s.id)}>
              {t('market.home.open')}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
