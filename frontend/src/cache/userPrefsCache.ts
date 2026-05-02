/**
 * IndexedDB cache for the per-user sheet preferences (Phase 2b).
 *
 * Per ADR-0003, the server is authoritative — IDB is only a local mirror that
 * lets the Sheet render the user's row order/hide state INSTANTLY on load
 * (before the server fetch returns) and lets drag-reorder feel snappy without
 * waiting for the round-trip. Every successful PATCH writes through to IDB,
 * so the local copy stays consistent.
 *
 * Storage shape:
 *   key:   `prefs:user:${userId}`
 *   value: { row_order: number[], hidden_rows: number[], updated_at: string|null,
 *            cached_at: number (ms epoch), schema_version: number }
 *
 * Schema versioning: bump SCHEMA_VERSION when the value shape changes. Loaders
 * silently ignore mismatched versions and return null so the next server fetch
 * repopulates the cache. Avoids needing IDB upgrade ceremony for every tweak.
 */
import { get, set, del } from 'idb-keyval';
import type { IUserSheetPreferences } from '@/types';

const SCHEMA_VERSION = 1;

interface ICachedUserPrefs extends IUserSheetPreferences {
  cached_at: number;
  schema_version: number;
}

function key(userId: number): string {
  return `prefs:user:${userId}`;
}

/**
 * Load the cached prefs for a user. Returns null if absent, expired (caller
 * decides), or written by an older schema version.
 */
export async function loadCachedPrefs(userId: number): Promise<IUserSheetPreferences | null> {
  if (!userId) return null;
  try {
    const raw = await get<ICachedUserPrefs>(key(userId));
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schema_version !== SCHEMA_VERSION) return null;
    if (!Array.isArray(raw.row_order) || !Array.isArray(raw.hidden_rows)) return null;
    return {
      row_order: raw.row_order,
      hidden_rows: raw.hidden_rows,
      updated_at: raw.updated_at,
    };
  } catch {
    // IDB unavailable (private mode, etc.) or cache corrupted — fall through
    // to server fetch.
    return null;
  }
}

/**
 * Persist prefs to IDB. Best-effort: failures (quota exceeded, IDB
 * unavailable) are swallowed — the server is authoritative anyway.
 */
export async function saveCachedPrefs(
  userId: number,
  prefs: IUserSheetPreferences,
): Promise<void> {
  if (!userId) return;
  try {
    const payload: ICachedUserPrefs = {
      ...prefs,
      cached_at: Date.now(),
      schema_version: SCHEMA_VERSION,
    };
    await set(key(userId), payload);
  } catch {
    // Swallow — see docstring.
  }
}

/**
 * Drop the cached prefs for a user. Used on logout (called by the auth
 * teardown when implemented) or as a manual reset from devtools.
 */
export async function clearCachedPrefs(userId: number): Promise<void> {
  if (!userId) return;
  try {
    await del(key(userId));
  } catch {
    // Swallow.
  }
}
