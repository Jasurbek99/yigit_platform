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

## Component rules

- One component per file, functional only
- Default export for page components, named export for shared components
- Props interface defined in same file or imported from `types/`
- Max 150 lines per component — extract sub-components if longer
- Internal order: hooks → derived state → handlers → effects → early returns → JSX

## Auth integration

httpOnly cookie — frontend never reads the JWT directly. Axios sends cookies automatically.
- On 401 from any API: interceptor redirects to `/login`
- CSRF: Axios includes `X-CSRFToken` header on POST/PUT/PATCH/DELETE
- Role info: `GET /api/v1/auth/me/` returns `{ role, editable_fields[] }`
- Protect routes: `<ProtectedRoute roles={['export_manager', 'document_team']}>` wrapper
