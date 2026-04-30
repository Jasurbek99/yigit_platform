# Cron Jobs — YGT Platform

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
| `p3_plan_critical_late` | Monday 00:00 of plan week | Block managers (missing plan) + admin (escalation) |

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
