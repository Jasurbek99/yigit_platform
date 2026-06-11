/**
 * Role choices — mirrors backend ROLE_CHOICES in apps/core/roles.py.
 * `labelKey` maps to existing `roles.*` i18n keys in tk/ru/en.json.
 */
export const ROLE_CHOICES: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'export_manager',     labelKey: 'roles.export_manager' },
  { value: 'loading_dept_head',  labelKey: 'roles.loading_dept_head' },
  { value: 'loading_dept_head_deputy', labelKey: 'roles.loading_dept_head_deputy' },
  { value: 'warehouse_chief',    labelKey: 'roles.warehouse_chief' },
  { value: 'weight_master',      labelKey: 'roles.weight_master' },
  { value: 'document_team',      labelKey: 'roles.document_team' },
  { value: 'transport',          labelKey: 'roles.transport' },
  { value: 'sales_rep',          labelKey: 'roles.sales_rep' },
  { value: 'finansist',          labelKey: 'roles.finansist' },
  { value: 'director',           labelKey: 'roles.director' },
  { value: 'accountant',         labelKey: 'roles.accountant' },
  { value: 'greenhouse_manager', labelKey: 'roles.greenhouse_manager' },
  { value: 'seller',             labelKey: 'roles.seller' },
  { value: 'boss',               labelKey: 'roles.boss' },
] as const;
