import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLot } from '../hooks/useLot';

/** Placeholder so `/lots/:id` (the QR claim's target) resolves — the lot screen arrives in Task 6. */
export default function LotScreen(): ReactElement {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const lot = useLot(Number(id));

  if (lot.isLoading) return <div className="mk-loading">{t('market.shell.loading')}</div>;
  if (!lot.data) return <div className="mk-loading">{t('market.shell.load_error')}</div>;
  return <h2 className="mk-title">{lot.data.shipment.export_code || lot.data.shipment.code}</h2>;
}
