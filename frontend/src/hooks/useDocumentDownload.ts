import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { downloadFile } from '@/utils/fileDownload';

interface IUseDocumentDownload {
  readonly isGenerating: boolean;
  /** Download a generated document. Resolves `true` on success, `false` on failure. */
  readonly download: (path: string) => Promise<boolean>;
}

/**
 * Shared download-with-spinner behaviour for the document buttons.
 *
 * Every generated document goes through the same three steps: flip a spinner so
 * the user cannot fire a duplicate request (the PDF path shells out to
 * LibreOffice and takes 10-30s), surface the server's error message as a toast,
 * and clear the spinner either way. The boolean result lets the caller decide
 * whether to close its modal — it should stay open when the download failed.
 */
export function useDocumentDownload(): IUseDocumentDownload {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);

  const download = async (path: string): Promise<boolean> => {
    setIsGenerating(true);
    try {
      await downloadFile(path);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('documents.download_failed'));
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  return { isGenerating, download };
}
