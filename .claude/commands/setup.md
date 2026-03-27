# Project Setup (Phase 0)

Initialize the YGT Platform project from scratch. Run ONCE at the start.

## Backend

```bash
mkdir -p backend/apps/core backend/apps/export backend/config backend/scripts
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
django-admin startproject config .
python manage.py startapp core apps/core
python manage.py startapp export apps/export
```

Configure `config/settings.py`:
- DATABASES: mssql-django pointing to YGT_Platform DB (Cyrillic_General_CI_AS collation)
- INSTALLED_APPS: `apps.core`, `apps.export`, `rest_framework`, `django_filters`, `corsheaders`
- REST_FRAMEWORK: PageNumberPagination (page_size=50), JWT auth
- SIMPLE_JWT: access token in httpOnly cookie
- CORS: allow frontend dev server origin
- AUTH_USER_MODEL: `core.User` (extends AbstractUser)

### First models (minimal core)
Create ONLY these to start:
- `User` (extends AbstractUser, adds `role`, `phone`, `telegram_chat_id`)
- `ShipmentStatusType` (code, name_tk/en/ru, step_order, required_role, phase)
- `ExportFirm` (code, name_tk/ru/en, is_active)
- `Country` (name_tk/ru/en, code)

Load seed data from DDL v5.1 INSERT statements.

## Frontend

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install antd @ant-design/pro-components @ant-design/icons \
    @tanstack/react-query zustand axios react-router-dom \
    react-i18next i18next dayjs
```

Create: App.tsx with Router, Layout with Sidebar, Login page placeholder.

## Verify
- Backend: `python manage.py runserver` → admin at /admin/
- Frontend: `npm run dev` → login page renders
- DB: seed data queryable

## Git
```bash
git init && git add . && git commit -m "feat(core): initial project scaffold with MSSQL"
```
