# Code Review

## Scope: $ARGUMENTS

Use the `reviewer` agent to perform a full project-specific review. The reviewer checks:

1. **CRITICAL**: MSSQL violations (JSONField, ArrayField, DISTINCT ON, bulk_create batch size)
2. **CRITICAL**: Architecture decisions (AD-1 timestamps via transition_to only, AD-2 no writes to vehicle_status_note, AD-3 weekly plan 12 columns)
3. **HIGH**: Module dependency direction (core ← export ← contracts ← finance)
4. **HIGH**: DDL v5.1 alignment (table names, column types, FK relationships)
5. **HIGH**: Shipment transition logic (always through transition_to, never direct status_id update)
6. **MEDIUM**: Auth security (httpOnly cookie, CSRF on mutations, no localStorage tokens)
7. **MEDIUM**: Frontend patterns (TanStack Query for server data, i18n, mock data)

Report sorted by severity.
