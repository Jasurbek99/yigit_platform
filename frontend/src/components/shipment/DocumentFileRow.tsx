import { useTranslation } from 'react-i18next';
import { Button } from 'antd';

import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';

interface IDocumentFileRowProps {
  readonly label: string;
  /** Authenticated streaming URL — served inline, so it opens in the browser. */
  readonly href: string;
  readonly filename: string;
}

/**
 * An uploaded file (contract attachment, quality scan). The auth cookie is
 * httpOnly and same-origin, so plain links work: «Open» previews it in a new
 * tab, «Download» saves it under its original name.
 */
export function DocumentFileRow({ label, href, filename }: IDocumentFileRowProps) {
  const { t } = useTranslation();
  return (
    <DocumentRowShell label={label}>
      <Button size="small" href={href} target="_blank" rel="noopener noreferrer">
        {t('shipment_detail.docs.open')}
      </Button>
      <Button size="small" href={href} download={filename}>
        {t('documents.download')}
      </Button>
    </DocumentRowShell>
  );
}
