# Frontend Architecture Rules

## State management boundaries (STRICT)

| Data type | Tool | Example |
|-----------|------|---------|
| Server data (API responses) | TanStack Query | shipments list, firm details, status log |
| Form state | Ant Design `Form.useForm()` | shipment create form, sales report form |
| URL-reflected filters | React Router `useSearchParams` | status filter, country filter, search query |
| Cross-component UI state | Zustand | sidebar collapsed, locale, active kanban column |
| Single-component UI state | `useState` | modal open, dropdown expanded, tooltip visible |

NEVER put API data in Zustand. NEVER mirror form fields in useState. NEVER use React Context for state that multiple components need.

## File organization

```
src/
  pages/{module}/      → route-level components, one per screen
  components/          → shared across modules (StatusTag, EmptyState, QueryWrapper)
  hooks/               → one file per API resource (useShipments.ts, useExportFirms.ts)
  types/               → mirrors API response shapes, not DB columns
  services/api.ts      → Axios instance + httpOnly cookie auth + CSRF
  stores/              → Zustand stores (UI state only)
  mock/                → mock data matching API response shapes
  i18n/{tk,ru,en}.json → translations
```

Dependency direction mirrors backend: `pages/export/` never imports from `pages/contracts/` or `pages/finance/`. Shared code goes in `components/`, `hooks/`, `types/`.

## Ant Design component rules

- `ProTable` for ALL data tables (never basic `Table`) — built-in search, sort, filter, pagination
- `Form` + `Form.Item` for all input forms — validation, layout, error display
- `Descriptions` for read-only detail views — label-value pairs
- `Tag` with color for status badges — status phase → color mapping
- `message` for toasts, `Modal.confirm` for destructive actions
- `Tabs` for ShipmentDetail sections
- Responsive: `responsive: ['md']` on ProTable columns to auto-hide on mobile

## Table sorting

### Client-side tables (all data loaded, no pagination or fixed page)
Add `sorter` function to every meaningful column. Skip: computed render-only columns (no single dataIndex), action button columns, phone/contact fields.

**Sorter patterns:**
- String (nullable): `sorter: (a, b) => (a.field || '').localeCompare(b.field || '')`
- String (required): `sorter: (a, b) => a.field.localeCompare(b.field)`
- Number (nullable): `sorter: (a, b) => (a.field ?? 0) - (b.field ?? 0)`
- Boolean active-first with secondary sort:
  ```typescript
  sorter: (a, b) => {
    const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
    if (diff !== 0) return diff;
    return a.code.localeCompare(b.code);
  }
  ```

**Default sort:** `defaultSortOrder: 'ascend' | 'descend'` on the primary sort column.
- Code-keyed reference lists (blocks): `defaultSortOrder: 'ascend'` on `code`
- Active/inactive reference lists (firms): `defaultSortOrder: 'descend'` on `is_active`, with secondary sort encoded inside the sorter function

### Server-side tables (paginated, e.g. ShipmentList)
Not yet implemented. Future pattern:
- `?ordering=field` (ASC) or `?ordering=-field` (DESC) query param to Django
- Add `ordering` to the filter interface in the hook
- `sorter: true` on columns + ProTable `onChange` handler to capture sort state
- Reflect in URL via `useSearchParams` (consistent with existing filter params)
- Backend: add `OrderingFilter` to the DRF viewset

## Component rules

- One component per file, functional only
- Default export for page components, named export for shared components
- Props interface defined in same file or imported from `types/`
- Max 150 lines per component — extract sub-components if longer
- Internal order: hooks → derived state → handlers → effects → early returns → JSX

## When to create a reusable component in `src/components/`

Extract to `src/components/` (not inline in a page) when ANY of these are true:

1. **Used in 2+ pages or modules** — duplicated JSX/logic is always extracted
2. **Self-fetching form control** — a `Select`, `Cascader`, or similar input that owns its own TanStack Query call (e.g. `CountrySelect`, `CitySelect`, `ExportFirmSelect`, `CustomerSelect`)
3. **Domain-specific display widget** — a reusable render piece tied to a model (e.g. `StatusTag`, `WeightDisplay`, `CargoCodeLink`)

### Self-fetching form control pattern (STRICT)

Any `Select` that fetches its own options MUST be extracted as a named component:

```tsx
// src/components/CountrySelect.tsx
interface ICountrySelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: SizeType;
  style?: React.CSSProperties;
}

export function CountrySelect({ value, onChange, ...rest }: ICountrySelectProps) {
  const { data = [] } = useCountries();
  const options = data.map(c => ({ value: c.id, label: c.name_en }));
  return <Select value={value} onChange={onChange} options={options} showSearch {...rest} />;
}
```

Rules for self-fetching controls:
- Accept standard Ant Design `Select` props (`value`, `onChange`, `disabled`, `allowClear`, `placeholder`, `size`, `style`)
- `onChange` emits the primitive ID (`number | null`), never the full object
- The component owns the query — the **page never duplicates the query**
- If the control supports inline-create (type a new name → create it), handle it inside the component via `dropdownRender`; the page stays unaware of create logic

## Internationalisation (i18n) — STRICT

All user-visible text MUST exist in all three languages: Turkmen (`tk`), Russian (`ru`), English (`en`).

**Library:** `react-i18next`. Hook: `const { t } = useTranslation();`

### Rules

- NEVER hardcode a string in JSX, form labels, table column titles, placeholder text, toast messages, modal content, button labels, or error messages — use `t('key')` always
- NEVER add a key to one JSON file without adding it to all three (`i18n/tk.json`, `i18n/ru.json`, `i18n/en.json`)
- NEVER use one language as a placeholder for another (e.g. copying the Turkmen string into `ru.json` temporarily)
- Keys use hierarchical dot notation namespaced by screen/domain: `login.submit`, `shipment.status_filter`, `common.required`

### Correct pattern

```typescript
// component
const { t } = useTranslation();
<Button>{t('shipment.create_button')}</Button>
toast.success(t('users_admin.toast_created'));
```

```json
// i18n/tk.json
{ "users_admin": { "toast_created": "Ulanyja döredildi" } }

// i18n/ru.json
{ "users_admin": { "toast_created": "Пользователь создан" } }

// i18n/en.json
{ "users_admin": { "toast_created": "User created" } }
```

### Wrong — all of these are violations

```typescript
// Hardcoded Turkmen
toast.success('Ulanyja döredildi');

// Hardcoded English label
<Title>Dashboard</Title>

// Key missing from ru.json or tk.json
```

### Parameterised strings

Use `{{variable}}` in JSON values and pass the object as the second argument:

```typescript
t('kanban.weight', { weight: Number(shipment.weight_net).toLocaleString() })
// tk.json: "weight": "Agramy: {{weight}} kg"
```

## Auth integration

httpOnly cookie — frontend never reads the JWT directly. Axios sends cookies automatically.
- On 401 from any API: interceptor redirects to `/login`
- CSRF: Axios includes `X-CSRFToken` header on POST/PUT/PATCH/DELETE
- Role info: `GET /api/v1/auth/me/` returns `{ role, editable_fields[] }`
- Protect routes: `<ProtectedRoute roles={['export_manager', 'document_team']}>` wrapper
