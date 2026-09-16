# Cron Jobs — YGT Platform

> **Docker deploys:** the host-crontab recipes below assume a bare-metal install with a
> host virtualenv at `/opt/ygt/backend/venv`. Under the Docker deploy that path does not
> exist, so a line copy-pasted verbatim fails silently every run — this is exactly what
> happened to `run_weekly_plan_setup` (moved to Celery beat 2026-09-16). **`run_harvest_dispatcher`
> and `rollup_actuals` are still crontab-only and have NOT been verified on the beta server.**
> Check with `ls /opt/ygt/backend/venv/bin/python` and `tail /var/log/ygt/dispatcher.log`
> before assuming they run.

## Harvest Dispatcher (run_harvest_dispatcher)

Evaluates and fires time-based harvest forecast and plan submission notifications.
Runs on a 5-minute cadence. Idempotent — safe to run multiple times per window.

### What it does

1. Reads `GreenhouseConfig` (singleton) for timezone and trigger thresholds.
2. Converts UTC now to local naive datetime (default: Asia/Ashgabat = UTC+5).
3. Calls `evaluate_triggers()` — determines which of the 6 trigger types are due.
4. Calls `fire()` for each event — creates `HarvestDispatchLog` + `Notification` rows.
5. Idempotency: `HarvestDispatchLog.UNIQUE(trigger_kind, target_user, scope_date)` prevents duplicate notifications if the cron overlaps.

### Trigger types

| Kind | When | Who |
|------|------|-----|
| `t1_forecast_nudge` | `forecast_primary_open` − `notification_lead_minutes` (default 16:00) | Block managers with missing tomorrow forecasts |
| `t2_forecast_handoff` | `forecast_primary_close` (default 18:00) | warehouse_chief users with gap list |
| `t3_forecast_escalation` | `forecast_fallback_close` (default 09:00 day-of) | warehouse_chief + admin + director |
| `p1_plan_reminder` | Friday 09:00 | Block managers with unsubmitted next-week plan |
| `p2_plan_late` | Saturday 09:00 | Block managers with unsubmitted next-week plan |
| `p3_plan_critical_late` | `plan_critical_late_at_time` on Monday of plan week (default 09:00) | Block managers (missing plan) + admin (escalation) |

### Linux/Mac cron entry

```cron
*/5 * * * * cd /opt/ygt/backend && /opt/ygt/backend/venv/bin/python manage.py run_harvest_dispatcher >> /var/log/ygt/dispatcher.log 2>&1
```

Add via `crontab -e`. The log file `/var/log/ygt/dispatcher.log` should be rotated with `logrotate`.

### Windows Task Scheduler

Create a basic task in Task Scheduler:

- **Trigger**: Daily, repeat every 5 minutes for a duration of 1 day (infinite recurrence).
- **Action**: Start a program
  - Program/script: `D:\projects\yigit_platform\backend\venv\Scripts\python.exe`
  - Arguments: `manage.py run_harvest_dispatcher`
  - Start in: `D:\projects\yigit_platform\backend`
- **Settings**: Run task as soon as possible after a scheduled start is missed.

Example PowerShell to register the task (run as Administrator):

```powershell
$action = New-ScheduledTaskAction `
    -Execute "D:\projects\yigit_platform\backend\venv\Scripts\python.exe" `
    -Argument "manage.py run_harvest_dispatcher" `
    -WorkingDirectory "D:\projects\yigit_platform\backend"

$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)

Register-ScheduledTask `
    -TaskName "YGT_HarvestDispatcher" `
    -Action $action `
    -Trigger $trigger `
    -RunLevel Highest `
    -Force
```

## Weekly Plan Setup (run_weekly_plan_setup) — Celery beat, NOT crontab

Runs **once a day** (not on the 5-minute dispatcher cadence). For the current and
next ISO week of the active season it (1) `initialize_upcoming_weeks` — ensures
every active top-level block has its `WeeklyHarvestPlan` container + Mon–Sun
`HarvestDayEntry` cells, and (2) `generate_weekly_plan_tasks` — creates the "fill
weekly plan" task per (active manager, block). Both idempotent, so re-running is a
cheap no-op. This is what guarantees a block manager always opens a complete grid
(historically weeks were only initialized ad-hoc → future weeks were empty).

### Scheduling — nothing to install

Since 2026-09-16 this is a **Celery beat entry**, already running in the
`celery-beat` container. No crontab, no per-server paths:

```python
# config/settings.py — CELERY_BEAT_SCHEDULE
'weekly-plan-setup': {
    'task': 'apps.export.tasks.run_weekly_plan_setup',   # apps/export/tasks.py
    'schedule': crontab(hour=6, minute=0),               # 06:00 CELERY_TIMEZONE (Asia/Ashgabat)
    'options': {'expires': 3600},
},
```

**Remove any host crontab line for this command.** It previously shipped as
`0 6 * * * cd /opt/ygt/backend && venv/bin/python manage.py run_weekly_plan_setup`;
on the Docker deploy that path does not exist, so the job silently never ran and
weekly-plan tasks appeared only when someone pressed "Generate plan tasks".

Verify after a deploy:

```bash
docker compose logs celery-beat | grep weekly-plan-setup      # beat picked up the schedule
docker compose logs celery-worker | grep 'Weekly-plan setup'  # the 06:00 run happened
```

Force a run now (no need to wait for 06:00):

```bash
docker compose exec backend python manage.py run_weekly_plan_setup
```

The manual buttons ("Initialize Week" admin/director, "Generate plan tasks"
admin/export_manager/director) remain for ad-hoc back-fills of arbitrary weeks.

### Idempotency guarantee

Running the dispatcher multiple times within the same 5-minute window is safe.
The `UNIQUE(trigger_kind, target_user_id, scope_date)` constraint on
`export.harvest_dispatch_log` prevents duplicate `Notification` rows.
The second run returns `fire() → False` (skipped) for each already-fired event.

### Manual test

```python
# In Django shell: python manage.py shell
from apps.greenhouse.dispatcher import TriggerEvent, fire
from datetime import date

ev = TriggerEvent(
    kind='t1_forecast_nudge',
    target_user_id=1,
    scope_date=date.today(),
    notification_kind='forecast_nudge',
    message='test',
    link='/test',
)
print(fire(ev))   # True  — first fire
print(fire(ev))   # False — idempotent (already fired)
```
