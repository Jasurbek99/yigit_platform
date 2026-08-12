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
| redis | redis:7-alpine | 6379 | Cache (permission cache, sessions) + Celery broker |
| nginx | nginx:alpine | 80/443 | Reverse proxy (production) |
| celery-worker | Custom (backend image) | — | Runs background tasks (Traccar fleet poll) |
| celery-beat | Custom (backend image) | — | Scheduler — fires `poll_traccar` every 120s |

> **Scheduler services must be started explicitly.** The deploy service list
> must include `celery-worker celery-beat`, or the fleet map never receives
> fresh GPS data (the poller simply doesn't run). On the beta host `update.sh`,
> that means `SERVICES="backend frontend redis celery-worker celery-beat"`.
> On a fresh bring-up:
> `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d celery-worker celery-beat`.
> Note: `celery` must be pip-installed before restarting Django —
> `config/__init__.py` imports it at boot, so `--build` (or `pip install -r
> requirements.txt`) must precede the restart.

> **`backend`, `celery-worker` and `celery-beat` must all build with
> `context: .` + `dockerfile: backend/Dockerfile`.** The Dockerfile's `COPY`s
> are repo-root-relative (`COPY backend/ .`, `COPY docs/how_works
> /opt/ygt/docs/how_works`) because `docs/how_works/` lives outside `backend/`.
> A narrower `context: ./backend` on any one of them fails the build with
> `failed to compute cache key: "/docs/how_works": not found` — and since
> Compose builds all images in a single bake, **the whole bake aborts and
> `backend`/`frontend` never finish either**, so the deploy fails outright. This
> bit the 2026-08-12 production rebuild. Frontend stays on `./frontend`.

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
| `REDIS_URL` | Redis connection (cache + Celery broker) | `redis://redis:6379/0` |
| `TRACCAR_BASE_URL` | Traccar GPS server (fleet map) | `http://10.10.11.79:8082` |
| `TRACCAR_TOKEN` | Traccar API Bearer token _(secret)_ | _(minted, exp 2027-07-31)_ |
| `TRACCAR_STALE_MINUTES` | Position staleness threshold | `15` |
| `VITE_USE_MOCK` | Frontend mock mode | `true` / `false` |
| `VITE_API_URL` | Backend API URL | `http://localhost:8000` |
| `VITE_MAP_TILE_URL` | Fleet-map tile source | OSM default |

> **`TRACCAR_*` live in the compose-project-root `.env`** (interpolated into
> the `celery-worker`/`celery-beat` `environment:` blocks). They are **not** on
> the `backend` service — backend reads positions from the DB, so
> `manage.py poll_traccar_positions` only works inside the `celery-worker`
> container. Empty `TRACCAR_BASE_URL` → `MissingSchema '/api/devices'` in the
> logs and the map stops updating.

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

# 6. Seed Traccar fleet devices (fleet map) — one-time, idempotent.
#    Run inside the celery-worker container (it has the TRACCAR_* env).
#    After this, celery-beat keeps positions fresh every 120s automatically;
#    poll_traccar also auto-registers any trucks added later.
python manage.py seed_traccar_devices
```

## MSSQL Compatibility Reminders

See [MSSQL Compatibility Rules](../../.claude/rules/mssql-compat.md) for full list.

- No `JSONField`, no `ArrayField`, no `DISTINCT ON`
- `bulk_create()` always with `batch_size=500`
- `db_collation='Cyrillic_General_CI_AS'` on Turkmen/Russian text fields
- `DecimalField` for money and weight (never `FloatField`)
