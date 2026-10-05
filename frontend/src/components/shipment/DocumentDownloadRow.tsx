import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'antd';

import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { useDocumentDownload } from '@/hooks/useDocumentDownload';

export interface IDocumentFormat {
  readonly label: string;
  /** API path relative to /api/v1, query string included. */
  readonly path: string;
}

interface IDocumentDownloadRowProps {
  readonly label: ReactNode;
  readonly formats: readonly IDocumentFormat[];
  /** Set → every format is blocked, and this says why. */
  readonly hint?: string | null;
}

/**
 * A generated document with one button per format — a click downloads it,
 * no menu and no options modal (the options live in the card's top bar).
 * The other formats wait while one generates: a PDF holds a LibreOffice slot
 * for 10-30 s and the server only has two.
 */
export function DocumentDownloadRow({ label, formats, hint }: IDocumentDownloadRowProps) {
  const { download } = useDocumentDownload();
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const handleClick = async (path: string): Promise<void> => {
    setBusyPath(path);
    await download(path);
    setBusyPath(null);
  };

  return (
    <DocumentRowShell label={label} hint={hint}>
      {formats.map((format) => (
        <Button
          key={format.label}
          size="small"
          loading={busyPath === format.path}
          disabled={Boolean(hint) || (busyPath !== null && busyPath !== format.path)}
          onClick={() => void handleClick(format.path)}
        >
          {format.label}
        </Button>
      ))}
    </DocumentRowShell>
  );
}
