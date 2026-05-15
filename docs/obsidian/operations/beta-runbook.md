---
title: Production Beta Runbook (2026-05-15)
tags: [operations, beta, deployment, runbook]
related: [[../reference/deployment-guide]], [[known-issues]], [[../screens/feedback-module]]
---

# Production Beta Runbook — 2026-05-15

Internal beta for YGT staff. Runs on the office server's Docker stack against the live MSSQL `YIGIT_PLATFROM_NEW` at `10.10.11.233\YIGIT`. LAN access only; no external users.

This runbook is the day-of operator's checklist. It assumes the pre-flight steps in [[../../../.claude/plans/from-tomorrow-need-to-playful-diffie|the beta plan]] are complete.

## Pre-flight checklist (run before staff arrive)

- [ ] Working tree clean, `beta-2026-05-15` tag created and pushed.
- [ ] `backend/.env` on office server has the **rotated** `SECRET_KEY` (not the `django-insecure-dev-key-…` default).
- [ ] `backend/.env` `ALLOWED_HOSTS` includes the office server hostname + IP.
- [ ] `backend/.env` `CSRF_TRUSTED_ORIGINS` includes the same as `http://…` URLs.
- [ ] `docker-compose.prod.yml` is in the repo root on the office server.
- [ ] `frontend/.dockerignore` is in the repo on the office server (prevents dev `.env` from poisoning the prod bundle).
- [ ] Pre-beta DB backup exists (filename + path recorded below).
- [ ] All 42 migrations applied: `docker-compose ... exec backend python manage.py showmigrations | grep -c '\[ \]'` returns `0`.
- [ ] 21 active TaskRule rows: `select count(*) from export_taskrule where is_active = 1` returns `21`.
- [ ] Phase 1.9 dry-run smoke test passed last night.

## Deploy

From the office server (NOT the dev machine):

```bash
# Pull latest from main + the new beta tag
git fetch && git checkout beta-2026-05-15

# Build the images (fresh frontend bundle picks up .dockerignore)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build backend frontend

# Bring up only what beta needs (no local db, no outer nginx)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend frontend redis

# Confirm health
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec backend \
  python -c "from django.conf import settings; print(settings.DATABASES['default']['HOST'], settings.DATABASES['default']['NAME'])"
# Must print: 10.10.11.233\YIGIT YIGIT_PLATFROM_NEW

# Confirm real data is reachable
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec backend \
  python manage.py shell -c "from apps.export.models import Shipment; print(Shipment.objects.count())"
# Must print a non-zero count matching prod expectations (>= 1959)
```

If any of those checks fails, **stop**. Do not invite staff in.

## Pre-beta DB backup

Recorded location: **TODO — fill in after the DBA runs the BACKUP**.

T-SQL to run from SSMS or sqlcmd on `10.10.11.233\YIGIT`:

```sql
BACKUP DATABASE [YIGIT_PLATFROM_NEW]
  TO DISK = 'X:\backups\YIGIT_PLATFROM_NEW_PRE_BETA_2026-05-15.bak'
  WITH COMPRESSION, INIT,
  NAME = 'Pre-beta snapshot 2026-05-15';
```

Restore command (only if a bug corrupts rows during beta):

```sql
ALTER DATABASE [YIGIT_PLATFROM_NEW] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [YIGIT_PLATFROM_NEW]
  FROM DISK = 'X:\backups\YIGIT_PLATFROM_NEW_PRE_BETA_2026-05-15.bak'
  WITH REPLACE;
ALTER DATABASE [YIGIT_PLATFROM_NEW] SET MULTI_USER;
```

## Golden-path smoke tests (run before staff arrive)

Run as `export_manager` (Gadam) unless noted:

1. **Login** — open the login URL on a fresh browser session. Land on `/dashboard`.
2. **Sheet** — open `/export/shipments/sheet`. Edit a number cell (try `0` in `rejected_weight_kg` — must persist as 0, not vanish to `—`). Edit one date cell + one datetime cell. Reload — values persist.
3. **Transition** — pick a `yuklenme` shipment, transition to `gumruk_girish`. Confirm a `ShipmentStatusLog` row exists and an `AuditLog` row was written.
4. **Auto-advance** — edit a target field that has a TaskRule. Task auto-resolves; timeline shows the new "Auto" tag.
5. **Comments + Tasks** — leave a comment with `@user:N` mention on a sheet cell. Log in as user N — task shows on `/me/board`. Click the card — drawer opens (not navigation). Mark done.
6. **Boss dashboard** — log in as `boss`, hit `/boss`. All 14 widgets render without console errors.
7. **Greenhouse** — open `/greenhouse/weekly-plan`. Fri + Sat columns visible.
8. **Feedback** — submit a test ticket via the floating button. Admin sees it at `/admin/feedback`.
9. **Mobile** — open the login page on a phone browser, log in, open one shipment, leave a comment. Layout doesn't break at 360px.

## Day-of monitoring

- Tail logs in a window you keep open:
  ```bash
  docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend frontend
  ```
- Pin a Telegram/WhatsApp thread for live "how do I" questions (in-app feedback is for tickets, chat is for live help).
- Have the rollback command ready: see "Rollback" below.

## During beta (May 15–22)

**Each morning** (before staff log in): fresh DB backup.

**Each evening**: triage every ticket in `/admin/feedback`. For each:
- Reply on the ticket with `mode: standard`.
- Real bug → add to [[known-issues]] with the template, link the ticket ID.
- Feature request → log to `DECISIONS.md` as a candidate ADR.

**Hotfix cycle**:
```bash
git checkout beta-2026-05-15 -b hotfix/<short-name>
# … fix + commit …
git checkout main && git merge hotfix/<short-name>
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build backend  # or frontend
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend  # or frontend
git tag -a beta-$(date +%F) -m "Hotfix cycle"
```

**No new feature work** during beta week — stabilization only.

## Rollback

If a bug corrupts data:

```bash
# 1. Stop the stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml stop

# 2. Restore the DB from the .bak (see "Pre-beta DB backup" above for T-SQL)

# 3. Roll the code back to the pre-beta tag
git checkout beta-2026-05-15
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build backend frontend
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend frontend redis
```

## Known fragile areas — warn staff and watch for

See full notes in [[known-issues]]. Quick reference:

- **Drafts everywhere by default**: new shipments land in `draft`, not `yuklenme`. Staff must use the "Promote to Loading" button on the detail page (or tick "Skip prep" on the create modal for legacy direct-to-loading flow).
- **AD-1 mostly retired**: lifecycle timestamps (`loading_started_at`, `departed_at`, etc.) now require operator entry on the Sheet. Empty Boss Dashboard widgets don't mean nothing happened — they mean cells aren't filled yet.
- **Self Kanban drawer**: clicking a task card opens a side drawer, not a navigation. Drawer footer has "Open shipment detail" link.
- **Sheet picker oddities** were patched today; if anything misbehaves, report via Feedback rather than fighting the cell.

## Out of scope (deferred post-beta)

- HTTPS/SSL (LAN-only acceptable for week 1).
- Frontend test harness expansion (3 tests landed; more later).
- Mobile PWA polish.
- CI/CD pipeline.
- Legacy `create_shipment()` AD-1 violation cleanup.
- Switch to `DJANGO_DEBUG=False` + proper `/static/` serving (requires outer nginx config).
