# Clean Code Rules — React/TypeScript

Code quality rules. For architecture (state management, file organization, auth) see `frontend-arch.md`.

## Naming
- **Components**: PascalCase — `ShipmentList`, `QuotaDashboard`, `StatusTag`
- **Hooks**: camelCase with `use` prefix — `useShipments`, `useUpdateShipment`
- **Utilities**: camelCase, verb-first — `formatWeight()`, `parseCargoCode()`
- **Constants**: SCREAMING_SNAKE — `MAX_TRUCK_WEIGHT_KG`, `STATUS_COLORS`
- **Interfaces**: `I` prefix — `IShipment`, `IExportFirm`, `IApiResponse<T>`
- **Event handlers**: `handle` prefix — `handleSubmit`, `handleStatusChange`
- **Boolean props/vars**: `is`/`has`/`can` — `isLoading`, `hasError`, `canEdit`
- **Files**: PascalCase for components (`ShipmentList.tsx`), camelCase for utils (`formatDate.ts`)

## TypeScript strictness
- NEVER `any` — use `unknown` and narrow with type guards
- NEVER type assertions (`as`) unless truly unavoidable
- ALWAYS return types on exported functions
- ALWAYS props interfaces — never inline `{ name: string }`
- `readonly` for props that shouldn't be mutated
- `Record<string, T>` not `{ [key: string]: T }`

## Component internal order
```
1. Imports (React → libs → components → hooks → types → utils)
2. Local types/interfaces
3. Local constants
4. Component function:
   a. Hooks (useState, useQuery, custom)
   b. Derived state / computed values
   c. Event handlers
   d. Effects (minimize useEffect)
   e. Early returns (loading, error, empty)
   f. JSX return
5. Export
```

## Hooks
- Return objects (not arrays) when >2 values: `{ data, isLoading, refetch }` not `[data, loading, refetch]`
- Never call hooks conditionally
- Minimize `useEffect` — transform API data in query's `select` instead
- Debounce search: `useDeferredValue` or custom `useDebounce`

## Imports
- Path aliases: `@/` = `src/`
- Order: React → external libs → components → hooks → types → utils
- Never circular imports between pages
- Co-locate tests: `ShipmentList.test.tsx` next to `ShipmentList.tsx`

## Performance
- `React.memo()` for expensive list items only, not by default
- `useMemo`/`useCallback` only for memoized children or expensive computations
- Lazy load pages: `React.lazy(() => import('./pages/export/ShipmentList'))`
- Paginate lists — never render 1000+ rows
