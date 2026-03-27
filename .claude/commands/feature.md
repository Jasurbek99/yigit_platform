# New Feature Implementation

## Feature: $ARGUMENTS

Follow this sequence. Each step must be complete before the next.

### 1. Locate
- Which Django app? (`core/`, `export/`, `contracts/`, `transport/`, `finance/`)
- Check DDL v5.1 — does the table already exist? Match names and columns.
- Check the DDL issues table in backend-dev agent — apply fixes if noted.

### 2. Backend: Model + Migration
- Create Django model matching DDL v5.1 table (use `class Meta: db_table = 'schema.table'`)
- If `models/` package: add to `__init__.py` re-exports
- Cross-app FKs: use string references (`'core.ExportFirm'`)
- Run `python manage.py makemigrations && python manage.py migrate`

### 3. Backend: Serializer + ViewSet + URLs
- List serializer (lightweight, no nested objects) + Detail serializer (with related data)
- Field names follow `api-contract.md` rules (DB `code` → API `cargo_code`)
- ViewSet with `permission_classes`, `filterset_fields`, `search_fields`
- Register in `urls.py` under `/api/v1/{app}/`

### 4. Frontend: Types + Mock + Hook
- TypeScript interface in `types/` matching the API response shape from api-contract.md
- Mock data in `mock/` with Turkmen names, Cyrillic text, edge cases
- TanStack Query hook in `hooks/` with `USE_MOCK` toggle

### 5. Frontend: Page
- React page component with Ant Design (ProTable for lists, Form for inputs)
- Loading, error, empty states
- Role-based field visibility via `editable_fields[]`
- i18n: all text through `useTranslation()`

### 6. Verify + commit
- `python manage.py test apps.{app} --verbosity=2`
- `npm run type-check`
- Use the `reviewer` agent to check the code
- Commit: `git add . && git commit -m "feat(scope): description"`
- Update `CHANGELOG.md` under `[Unreleased]` → `### Added`