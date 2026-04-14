---
title: Deployment Guide
tags: [reference, deployment, docker, mssql]
---

# Deployment Guide

> Docker Compose setup, MSSQL connection, environment variables, and seed commands.

For full setup instructions see [GETTING_STARTED.md](../GETTING_STARTED.md).

## Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| django | Custom (Dockerfile) | 8000 | Django backend API |
| react | Custom (Dockerfile) | 3000 (dev) / 80 (prod) | React frontend |
| mssql | mcr.microsoft.com/mssql/server:2022-latest | 1433 | MSSQL database |
| redis | redis:7-alpine | 6379 | Cache (permission cache, sessions) |
| nginx | nginx:alpine | 80/443 | Reverse proxy (production) |

## MSSQL Connection

| Setting | Value |
|---------|-------|
| Server | `10.10.11.233\YIGIT` |
| Database | `YIGIT_PLATFROM` (note: typo in actual DB name) |
| User | `YigitUser` |
| Driver | ODBC Driver 17 for SQL Server |

**Django settings** (`settings.py`):
```python
DATABASES = {
    'default': {
        'ENGINE': 'mssql',
        'NAME': 'YIGIT_PLATFROM',
        'HOST': '10.10.11.233\\YIGIT',
        'USER': 'YigitUser',
        'PASSWORD': '...',
        'OPTIONS': {'driver': 'ODBC Driver 17 for SQL Server'},
    }
}
```

## Key Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `SECRET_KEY` | Django secret key | _(generated)_ |
| `DB_HOST` | MSSQL server | `10.10.11.233\YIGIT` |
| `DB_NAME` | Database name | `YIGIT_PLATFROM` |
| `DB_USER` | Database user | `YigitUser` |
| `DB_PASSWORD` | Database password | _(secret)_ |
| `REDIS_URL` | Redis connection | `redis://redis:6379/0` |
| `VITE_USE_MOCK` | Frontend mock mode | `true` / `false` |
| `VITE_API_URL` | Backend API URL | `http://localhost:8000` |

## Seed Commands (run in order)

```bash
# 1. Apply migrations
python manage.py migrate

# 2. Seed reference data (statuses, countries, cities, firms, blocks)
python manage.py seed_data

# 3. Seed block manager assignments
python manage.py seed_block_managers

# 4. Seed default permissions
python manage.py seed_permissions

# 5. Import operational data (optional)
python manage.py import_shipments
python manage.py import_prices
python manage.py import_weekly_plan
python manage.py import_quotas
```

## MSSQL Compatibility Reminders

See [MSSQL Compatibility Rules](../../.claude/rules/mssql-compat.md) for full list.

- No `JSONField`, no `ArrayField`, no `DISTINCT ON`
- `bulk_create()` always with `batch_size=500`
- `db_collation='Cyrillic_General_CI_AS'` on Turkmen/Russian text fields
- `DecimalField` for money and weight (never `FloatField`)
