/**
 * Login round-trip for deep links. A pallet QR opens /scan/{id}; a logged-out
 * phone is sent to /login, and without `?next=` the target is lost and the
 * operator has to scan the pallet again.
 */
export function loginPathFor(path: string): string {
  if (path.startsWith('/m/') || path === '/m') return path.startsWith('/m/login') ? path : `/m/login?next=${encodeURIComponent(path)}`;
  if (path.startsWith('/login')) return path;
  if (path === '/') return '/login';
  return `/login?next=${encodeURIComponent(path)}`;
}

/** Only in-app paths — `//host` and `/\host` are read as another origin by browsers. */
export function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return null;
  return next;
}
