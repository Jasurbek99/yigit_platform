# Getting Started

## Prerequisites
- Docker & Docker Compose
- Node.js 20+ and npm
- Python 3.12+
- MSSQL Server (or use Docker MSSQL)
- Claude Code (`npm install -g @anthropic-ai/claude-code`)

## Step 1: Setup

```bash
git clone <repo-url> ygt-platform
cd ygt-platform
```

Place `.claude/` directory, `CLAUDE.md`, and `docs/` at the project root.

## Step 2: Database

Run `ygt_platform_ddl_v5_1.sql` on your MSSQL instance. This creates all schemas, tables, indexes, and seed data.

## Step 3: Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit DB credentials
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## Step 4: Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # set VITE_API_URL, VITE_USE_MOCK=true
npm run dev
```

## Step 5: Import data

```bash
python scripts/import_shipments.py data/Export_contracts.xlsx --dry-run
python scripts/import_shipments.py data/Export_contracts.xlsx
```

## Step 6: Claude Code

```bash
cd ygt-platform
claude

# Available slash commands:
/setup              # one-time project initialization
/feature <name>     # create a feature end-to-end
/model <name>       # create a Django model from DDL v5.1
/review <scope>     # code review
/analyze-excel <f>  # analyze Excel file for migration
/status             # sprint progress check
```

## Development modes

**Mock mode** (frontend only): `VITE_USE_MOCK=true npm run dev`
**Full stack**: backend `runserver` + frontend `npm run dev` with `VITE_USE_MOCK=false`
**Docker**: `docker-compose up -d` → access at http://localhost
