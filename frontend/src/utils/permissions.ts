/**
 * Dynamic permission helpers.
 *
 * Read from the page_permissions / resource_permissions / field_permissions
 * returned by /auth/me/ and cached in the useAuth() hook.
 */
import type { ICurrentUser } from '@/types';

// ── Route → page_code mapping ────────────────────────────────────────────

const ROUTE_PAGE_MAP: Record<string, string> = {
  '/':                        'dashboard',
  '/export/shipments':        'export.shipments',
  '/export/kanban':           'export.kanban',
  '/export/overdue':          'export.overdue',
  '/export/advances':         'export.advances',
  '/export/plan':             'export.plan',
  '/export/quota':            'export.quota',
  '/export/prices':           'export.prices',
  '/export/trucks':           'export.trucks',
  '/export/blocks':           'export.blocks',
  '/export/domestic-sales':   'export.domestic_sales',
  '/admin/users':             'admin.users',
  '/admin/seasons':           'admin.seasons',
  '/admin/firms':             'admin.firms',
  '/admin/import-firms':      'admin.import_firms',
  '/admin/permissions':       'admin.permissions',
  '/admin/blocks':            'admin.blocks',
  '/admin/truck-destinations':'admin.truck_dest',
};

/**
 * Check if a user can see a page/route.
 *
 * @param user  Current user from useAuth(), or null
 * @param pageCodeOrRoute  Either a page_code ('export.shipments') or a route path ('/export/shipments')
 */
export function canSeePage(user: ICurrentUser | null, pageCodeOrRoute: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  // Resolve route path to page_code if needed
  const pageCode = ROUTE_PAGE_MAP[pageCodeOrRoute] ?? pageCodeOrRoute;

  // If no page_permissions data yet (first load before /auth/me/ resolves),
  // fail-closed: deny access. ProtectedRoute handles the loading state separately.
  if (!user.page_permissions) {
    return false;
  }

  return user.page_permissions[pageCode] ?? false;
}

/**
 * Check if a user can perform an action on a resource.
 */
export function canDo(
  user: ICurrentUser | null,
  resource: string,
  action: 'view' | 'create' | 'edit' | 'delete',
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  const perm = user.resource_permissions?.[resource];
  if (!perm) return false;

  return perm[action] ?? false;
}

/**
 * Check if a user can edit a specific field on a resource.
 */
export function canEditField(
  user: ICurrentUser | null,
  resource: string,
  fieldName: string,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  const fields = user.field_permissions?.[resource];
  if (!fields || fields.length === 0) return false;

  return fields.includes('*') || fields.includes(fieldName);
}

/**
 * Get the page_code for a given route path.
 * Returns undefined if the route is not mapped.
 */
export function getPageCode(routePath: string): string | undefined {
  return ROUTE_PAGE_MAP[routePath];
}
