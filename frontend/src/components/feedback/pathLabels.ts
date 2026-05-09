import type { TFunction } from 'i18next';

/**
 * Maps URL paths to their corresponding i18n key.
 * Resolving at display time (not submit time) ensures the admin always sees
 * labels in their own locale, regardless of the submitter's language.
 */
const PATH_TO_I18N_KEY: Record<string, string> = {
  '/export/shipments': 'nav.shipments',
  '/export/shipments/sheet': 'nav.shipment_sheet',
  '/export/plan': 'nav.plan',
  '/export/quota': 'nav.quota',
  '/export/prices': 'nav.prices',
  '/export/trucks': 'nav.trucks',
  '/export/blocks': 'nav.blocks',
  '/export/domestic-sales': 'nav.domestic_sales',
  '/export/overdue': 'nav.overdue',
  '/export/advances': 'nav.advances',
  '/export/drafts': 'nav.drafts',
  '/export/assign': 'nav.assign',
  '/admin/users': 'nav.admin_users',
  '/admin/firms': 'nav.admin_firms',
  '/admin/import-firms': 'nav.admin_import_firms',
  '/admin/customers': 'nav.admin_customers',
  '/admin/blocks': 'nav.admin_blocks',
  '/admin/seasons': 'nav.admin_seasons',
  '/admin/permissions': 'nav.admin_permissions',
  '/admin/shipment-settings': 'nav.admin_shipment_settings',
  '/admin/truck-destinations': 'nav.admin_truck_dest',
  '/feedback/submit': 'nav.feedback_submit',
  '/feedback/my-tickets': 'nav.feedback_my_tickets',
  '/feedback/public': 'nav.feedback_public',
  '/admin/feedback': 'nav.feedback_admin_inbox',
};

/**
 * Resolve a submitted_from_path to a localised label.
 * Falls back to the raw path if no key is mapped (e.g. shipment detail pages).
 */
export function pathToLabel(path: string, t: TFunction): string {
  const key = PATH_TO_I18N_KEY[path];
  if (key) return t(key);
  // Strip leading slash for readability: /export/shipments/123 → export/shipments/123
  return path.startsWith('/') ? path.slice(1) : path;
}
