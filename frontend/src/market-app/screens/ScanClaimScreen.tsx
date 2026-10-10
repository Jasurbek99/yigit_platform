import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { drfFieldErrors } from '@/utils/drfErrors';
import { useOpenLot } from '../hooks/useLots';

/**
 * `/m/scan/:id` — a pallet QR scanned in the market app: open (or claim) the truck's lot
 * and go to it. 403 / 404 show the server's message and the way back to the trucks.
 */
export default function ScanClaimScreen(): ReactElement {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mutateAsync } = useOpenLot();
  const [error, setError] = useState<unknown>(null);
  // One POST per scanned id: StrictMode mounts twice, and a second POST under the same key
  // would come back «still running». The promise, not the observer state: StrictMode's
  // re-subscribe detaches the observer from the running mutation.
  const started = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (started.current === id) return;
    started.current = id;
    setError(null);
    mutateAsync({ shipment_id: Number(id) })
      .then((lot) => navigate(`/lots/${lot.id}`, { replace: true }))
      .catch(setError);
  }, [id, mutateAsync, navigate]);

  if (!error) {
    return (
      <div className="mk-loading">
        <i className="mk-loading-dot" />
        {t('market.scan.opening')}
      </div>
    );
  }
  return (
    <div className="mk-empty">
      <p className="mk-empty-title" role="alert">{drfFieldErrors(error)?.error?.[0] ?? t('market.scan.error')}</p>
      <button type="button" className="mk-btn mk-add" onClick={() => navigate('/', { replace: true })}>
        {t('market.scan.to_lots')}
      </button>
    </div>
  );
}
