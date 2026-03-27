# Tech Stack

## Backend
| Package | Why |
|---------|-----|
| Django 5.x + DRF | Team knows Python. AI generates Django well. |
| mssql-django + pyodbc | Logo Tiger ERP on MSSQL |
| djangorestframework-simplejwt | JWT auth (httpOnly cookie mode) |
| django-filter | Declarative queryset filtering |
| django-cors-headers | CORS for frontend dev server |
| openpyxl | Excel file reading for data migration |
| python-docx + WeasyPrint | Document generation |
| gunicorn | Production WSGI server |
| redis | Cache + future Celery broker |

## Frontend
| Package | Why |
|---------|-----|
| React 18 + TypeScript | Stable, hooks ecosystem |
| Vite | Fast build, HMR |
| antd 5 + @ant-design/pro-components | Enterprise ProTable, Form |
| @tanstack/react-query | Server state, caching |
| zustand | Client UI state only |
| axios | HTTP client (httpOnly cookie auth, CSRF) |
| react-router-dom 6 | Client-side routing |
| react-i18next + i18next | Turkmen, Russian, English |
| dayjs | Date formatting |

## Infrastructure
| Component | Technology |
|-----------|-----------|
| Database | MSSQL Server (DDL v5.1) |
| Cache | Redis 7 |
| Web server | Nginx (reverse proxy + static) |
| Container | Docker Compose (5 services) |
| Server | Company infrastructure (no cloud) |

## What we're NOT using
| Rejected | Why |
|----------|-----|
| PostgreSQL | MSSQL required for Logo Tiger |
| Next.js | Unnecessary for SPA |
| localStorage JWT | Users on public networks in KZ/RU — httpOnly cookies safer |
| Django signals | Implicit, hard to debug — use explicit service calls |
| Tailwind | Ant Design provides complete design system |
| Redux | Zustand simpler for UI state, TanStack Query for server state |
