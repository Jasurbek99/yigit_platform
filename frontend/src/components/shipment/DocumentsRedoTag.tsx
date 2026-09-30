import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

interface IDocumentsRedoTagProps {
  /** Shipment.documents_reset_at — set when a truck change rolled the shipment back. */
  resetAt: string | null | undefined;
  /** Short label for tight spots (the Sheet column header). */
  compact?: boolean;
}

/**
 * «Truck changed — redo the documents»: the shipment was rolled back to
 * Preparation because its Planning trip's truck changed (services/rollback.py).
 * Shown until «Gümrüge ugradyldy» closes again, which clears the stamp.
 */
export function DocumentsRedoTag({ resetAt, compact = false }: IDocumentsRedoTagProps) {
  const { t } = useTranslation();
  if (!resetAt) return null;
  return (
    <Tooltip title={t('shipment.documents_redo_since', { date: dayjs(resetAt).format('DD.MM HH:mm') })}>
      <Tag color="orange" style={compact ? { margin: 0, fontSize: 10, lineHeight: '16px' } : undefined}>
        {t(compact ? 'shipment.documents_redo_short' : 'shipment.documents_redo')}
      </Tag>
    </Tooltip>
  );
}
