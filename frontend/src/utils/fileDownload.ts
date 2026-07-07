import axios from 'axios';

import api from '@/services/api';

/**
 * Trigger a browser download of a same-origin authenticated file URL.
 *
 * Auth is an httpOnly cookie sent automatically on same-origin GET navigation,
 * so a plain anchor click downloads the protected file without extra handling.
 * Used by the Boss report exports and the contract document generators.
 */
export function downloadUrl(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Save a blob to disk under `filename` via a transient object URL. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download a protected file via the axios `api` instance so a non-2xx response
 * (e.g. a 400 validation block) can be caught and surfaced, instead of the raw
 * JSON opening in a new tab as a plain anchor would do.
 *
 * @param path API path relative to the `/api/v1` base (e.g. `/contracts/...`).
 * @throws Error with the server's `error` message when the request fails.
 */
export async function downloadFile(path: string): Promise<void> {
  try {
    const resp = await api.get(path, { responseType: 'blob' });
    const disposition = (resp.headers['content-disposition'] as string | undefined) ?? '';
    const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? 'document';
    saveBlob(resp.data as Blob, filename);
  } catch (error) {
    // Blob-typed error bodies must be read back to text to recover the message.
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      const text = await error.response.data.text();
      let message = '';
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? '';
      } catch {
        /* not JSON — leave message empty */
      }
      if (message) throw new Error(message);
    }
    throw error instanceof Error ? error : new Error('Download failed');
  }
}
