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
