# Team KPI Leaderboard — Visual Redesign Addendum

> Extends `2026-07-21-team-kpi-leaderboard.md`. The table version shipped (Tasks 1-8 + fix). User wants the Bitrix-style visual: per-user KPI **cards**, a **ranking bar chart**, and per-card **trend sparklines**. This addendum adds 3 tasks (9-11) on the same branch `feat/team-kpi-leaderboard`.

**Goal:** Replace the leaderboard table with a visual dashboard — a horizontal ranking bar chart + a responsive grid of per-user KPI cards (big completed number, on-time meter, overdue badge, active hours, 14-day trend sparkline, top-3 medals) — backed by a new per-day trend series.

**Data layer already built & reusable:** `GET /api/v1/core/team-kpi/?period=` + `useTeamKpi` hook + `ITeamKpiRow`. Only ADD a `trend` field and rebuild presentation.

**Infrastructure to reuse (do NOT add deps):**
- Charts: `@/components/EChart` (`import { EChart } from '@/components/EChart'`) — ECharts core wrapper, `BarChart`/`LineChart` already registered, auto-resizes, `loading`/`decorative`/`ariaLabel` props.
- Sparkline pattern: `buildSparkOption(points: number[])` in `frontend/src/pages/boss/HeroKpiStrip.tsx:26-42` (copy it).
- Card style: `KpiCard` in `HeroKpiStrip.tsx:44-127` — `borderRadius: 8`, body padding `12px 14px`, label `fontSize 11` uppercase, number `fontSize 24/28 weight 700 letterSpacing -0.02em`.
- Progress meter: antd `Progress` line variant, `strokeColor` green/orange (see `boss/ComplianceStrip.tsx:50-55`).
- Avatar initials: `initials(name)` helper in `frontend/src/components/PresenceAvatars.tsx:21-24` (lift to a shared util or copy).
- Colors: `import { COLORS } from '@/constants/styles'` — `primary #1677ff`, `success #52c41a`, `orange #fa8c16`, `danger #ff4d4f`, `textSecondary`, `border`, tints `bgBlue/bgGreen/bgOrange`.

## Global Constraints (in addition to the base plan's)

- **Dataviz rules (from the dataviz skill):**
  - Ranking bar chart = magnitude of ONE metric across users → **single hue** (`COLORS.primary`), NOT per-user colors. No legend (single series). Direct value labels at bar ends. Recessive axes/grid (`COLORS.border`). Horizontal bars, sorted desc.
  - On-time meter keeps **status** colors (green `>=0.8` else orange) but ALWAYS shows the `%` number beside it — never color-alone.
  - Sparkline = single hue (`COLORS.primary`), `decorative` (aria-hidden), no axes.
- App is light-theme only — no dark-mode chart steps needed.
- Trend window is a FIXED 14 days (Asia/Ashgabat), independent of the period selector. Document this so the sparkline isn't misread as period-scoped.
- i18n STRICT: every new visible string via `t()` in all three files (tk/ru/en).
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` (the `type-check` script is broken).
- Backend tests on real MSSQL; `TruncDate` compiles to `CAST(... AS date)` — MSSQL-safe.
- Component files ≤150 lines — extract `TeamKpiCard` and `TeamRankingChart` as their own components.
- One commit per task. Co-author trailer: `Claude Opus 4.8 (1M context)`.

---

### Task 9: Backend — add 14-day `trend` series to each KPI row

**Files:**
- Modify: `backend/apps/core/services_team_kpi.py` (`compute_team_kpi`, add a trend query + per-user pivot)
- Test: `backend/apps/core/tests_team_kpi.py` (append trend assertions to `ComputeTeamKpiTest`)

**Interfaces:**
- Produces: each row dict gains `trend: list[int]` of length 14 (oldest→newest daily completed count, attributed by `completed_by`, Asia/Ashgabat days).

- [ ] **Step 1: Write the failing test**

Append to `ComputeTeamKpiTest` in `backend/apps/core/tests_team_kpi.py`:

```python
    def test_trend_is_14_day_series(self):
        # 2 tasks completed today, 1 completed 3 days ago.
        now = timezone.now()
        self._done_task(self.alice, completed_at=now)
        self._done_task(self.alice, completed_at=now)
        self._done_task(self.alice, completed_at=now - timedelta(days=3))
        rows = {r['user_id']: r for r in compute_team_kpi('week')}
        trend = rows[self.alice.id]['trend']
        self.assertEqual(len(trend), 14)
        self.assertEqual(trend[-1], 2)      # today = last element
        self.assertEqual(trend[-4], 1)      # 3 days ago
        self.assertEqual(sum(trend), 3)
        # A user with no completions gets an all-zero 14-length series.
        self.assertEqual(rows[self.bob.id]['trend'], [0] * 14)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi.ComputeTeamKpiTest.test_trend_is_14_day_series --keepdb --verbosity=2`
Expected: FAIL — `KeyError: 'trend'`.

- [ ] **Step 3: Implement the trend query + pivot**

In `backend/apps/core/services_team_kpi.py`, add the import at the top of the file (with the other `django.db.models` imports add `TruncDate`):

```python
from django.db.models.functions import TruncDate
```

Add a module constant near `_VALID_PERIODS`:

```python
_TREND_DAYS = 14
```

Inside `compute_team_kpi`, after the active-seconds block (block 3) and before the roster merge (block 4), add:

```python
    # 3b. 14-day daily completion trend per user (fixed window, TM-local days).
    now_local = timezone.now().astimezone(_TM_TZ)
    trend_start_date = now_local.date() - timedelta(days=_TREND_DAYS - 1)
    trend_since = _local_midnight(trend_start_date)
    trend_rows = (
        Task.objects.filter(
            state=TaskState.DONE,
            completed_by__isnull=False,
            completed_at__gte=trend_since,
        )
        .annotate(day=TruncDate('completed_at', tzinfo=_TM_TZ))
        .values('completed_by', 'day')
        .annotate(c=Count('id'))
    )
    # index: {user_id: {date: count}}
    trend_by_user: dict[int, dict] = {}
    for r in trend_rows:
        trend_by_user.setdefault(r['completed_by'], {})[r['day']] = r['c']
    trend_dates = [trend_start_date + timedelta(days=i) for i in range(_TREND_DAYS)]
```

Then inside the roster loop (block 4), build the per-user series and add it to the payload dict:

```python
        user_trend_map = trend_by_user.get(u['id'], {})
        trend = [int(user_trend_map.get(d, 0)) for d in trend_dates]
```

and add `'trend': trend,` to the appended `payload.append({...})` dict.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python manage.py test apps.core.tests_team_kpi --keepdb --verbosity=2`
Expected: all PASS (existing + the new trend test).

Note: `TruncDate('completed_at', tzinfo=_TM_TZ)` groups by the calendar date in Asia/Ashgabat. If MSSQL rejects `tzinfo` on `TruncDate` at runtime (it should not — Django emits `CAST(... AT TIME ZONE ...)` / a converted expression), that is a real finding: report it and fall back to `TruncDate('completed_at')` (UTC days) with a documented note. Only deviate if a test actually fails.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/services_team_kpi.py backend/apps/core/tests_team_kpi.py
git commit -m "feat(core): add 14-day completion trend series to team KPI rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Frontend — cards + ranking bar chart + sparklines

**Files:**
- Modify: `frontend/src/types/teamKpi.ts` (add `trend: number[]` to `ITeamKpiRow`)
- Create: `frontend/src/components/team/TeamRankingChart.tsx`
- Create: `frontend/src/components/team/TeamKpiCard.tsx`
- Modify: `frontend/src/pages/team/TeamKpi.tsx` (rebuild: period switcher + error + ranking chart + card grid; drop the antd Table)
- Modify: `frontend/src/i18n/{tk,ru,en}.json` (new keys)

**Interfaces:**
- Consumes: `useTeamKpi(period)`, `ITeamKpiRow` (now with `trend`).

- [ ] **Step 1: Add `trend` to the type**

In `frontend/src/types/teamKpi.ts`, add to `ITeamKpiRow`:

```typescript
  trend: number[]; // 14-day daily completed count, oldest -> newest
```

- [ ] **Step 2: Add i18n keys (all three files)**

Reuse the existing `team_kpi.*` block. ADD these keys to `en.json` (and translate for `ru`/`tk`):

`en.json` additions inside `team_kpi`:
```json
  "ranking_title": "Ranking by completed tasks",
  "card_completed": "Completed",
  "card_on_time": "On time",
  "card_overdue": "Overdue now",
  "card_active": "Active",
  "card_trend": "Last 14 days",
  "no_users": "No users to show"
```
`ru.json`:
```json
  "ranking_title": "Рейтинг по выполненным задачам",
  "card_completed": "Выполнено",
  "card_on_time": "Вовремя",
  "card_overdue": "Просрочено",
  "card_active": "Активность",
  "card_trend": "Последние 14 дней",
  "no_users": "Нет пользователей"
```
`tk.json`:
```json
  "ranking_title": "Tamamlanan işler boýunça reýting",
  "card_completed": "Tamamlanan",
  "card_on_time": "Wagtynda",
  "card_overdue": "Möhleti geçen",
  "card_active": "Işjeňlik",
  "card_trend": "Soňky 14 gün",
  "no_users": "Ulanyjy ýok"
```
(Keep the existing `title`, `subtitle`, `period_*`, `load_error`, `no_data` keys.)

- [ ] **Step 3: Create `TeamRankingChart.tsx`**

Create `frontend/src/components/team/TeamRankingChart.tsx`. Single-hue horizontal bar chart of the top rows by `completed`, direct value labels, recessive axes, no legend. Uses the shared `EChart` wrapper.

```tsx
// Horizontal ranking bar chart — single metric (completed) across users.
// Single hue (magnitude), no legend, direct value labels — per dataviz rules.

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/EChart';
import { COLORS } from '@/constants/styles';
import type { ITeamKpiRow } from '@/types/teamKpi';

interface ITeamRankingChartProps {
  readonly rows: readonly ITeamKpiRow[];
  readonly max?: number;
}

const DEFAULT_MAX = 10;

export function TeamRankingChart({ rows, max = DEFAULT_MAX }: ITeamRankingChartProps) {
  const option = useMemo<EChartsOption>(() => {
    // rows arrive sorted desc by completed; take the top `max`, then reverse
    // so the biggest bar sits at the TOP of a horizontal ECharts category axis.
    const top = rows.slice(0, max).filter((r) => r.completed > 0);
    const data = [...top].reverse();
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.textSecondary },
      },
      yAxis: {
        type: 'category',
        data: data.map((r) => r.user_name),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.textSecondary },
      },
      series: [{
        type: 'bar',
        data: data.map((r) => r.completed),
        itemStyle: { color: COLORS.primary, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
        label: { show: true, position: 'right', color: COLORS.textSecondary },
      }],
    };
  }, [rows, max]);

  return <EChart option={option} height={Math.max(120, Math.min(rows.length, 10) * 34)} ariaLabel="Ranking by completed tasks" />;
}
```

- [ ] **Step 4: Create `TeamKpiCard.tsx`**

Create `frontend/src/components/team/TeamKpiCard.tsx`. One per-user card. Reuses the `KpiCard`/`buildSparkOption` idioms.

```tsx
// Per-user KPI card: rank medal, avatar, completed headline, on-time meter,
// overdue badge, active hours, 14-day trend sparkline.

import { Card, Progress, Tag, Typography, Avatar } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/EChart';
import { COLORS } from '@/constants/styles';
import type { ITeamKpiRow } from '@/types/teamKpi';

const { Text } = Typography;

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function buildSparkOption(points: number[]): EChartsOption {
  return {
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category', show: false, data: points.map((_, i) => String(i)) },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'line', data: points, smooth: true, symbol: 'none',
      lineStyle: { width: 1.5, color: COLORS.primary },
      areaStyle: { color: 'rgba(22,119,255,0.08)' },
    }],
  };
}

interface ITeamKpiCardProps {
  readonly row: ITeamKpiRow;
  readonly rank: number;
}

export function TeamKpiCard({ row, rank }: ITeamKpiCardProps) {
  const { t } = useTranslation();
  const pct = row.on_time_rate == null ? null : Math.round(row.on_time_rate * 100);
  const onTimeColor = row.on_time_rate != null && row.on_time_rate >= 0.8 ? COLORS.success : COLORS.orange;
  const hasTrend = row.trend.some((n) => n > 0);

  return (
    <Card size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: '12px 14px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, textAlign: 'center', fontWeight: 700 }}>
          {MEDALS[rank] ?? <Text type="secondary">{rank}</Text>}
        </span>
        <Avatar size={30} style={{ backgroundColor: COLORS.primary, color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {initials(row.user_name) || '?'}
        </Avatar>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text strong ellipsis style={{ display: 'block' }}>{row.user_name}</Text>
          <Tag color="blue" style={{ marginTop: 2 }}>{t(`roles.${row.role}`, { defaultValue: row.role })}</Tag>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {row.completed}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('team_kpi.card_completed')}</Text>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <Text type="secondary">{t('team_kpi.card_on_time')}</Text>
          <Text style={{ color: pct == null ? undefined : onTimeColor }}>{pct == null ? '—' : `${pct}%`}</Text>
        </div>
        <Progress percent={pct ?? 0} size="small" showInfo={false} strokeColor={onTimeColor} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
        <Text type="secondary">{t('team_kpi.card_overdue')}</Text>
        <Text style={{ color: row.overdue_now > 0 ? COLORS.orange : undefined }}>
          {row.overdue_now > 0 ? row.overdue_now : '—'}
        </Text>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
        <Text type="secondary">{t('team_kpi.card_active')}</Text>
        <Text type={row.active_seconds === 0 ? 'secondary' : undefined}>
          {row.active_seconds === 0 ? '—' : formatHm(row.active_seconds)}
        </Text>
      </div>

      {hasTrend && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{t('team_kpi.card_trend')}</Text>
          <div style={{ height: 32 }}>
            <EChart option={buildSparkOption(row.trend)} height={32} decorative />
          </div>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Rebuild `TeamKpi.tsx`**

Replace the table with the chart + card grid. Keep the period `Segmented` (in `?period=`) and the error `Alert`.

```tsx
// TeamKpi — public per-user task leaderboard (Bitrix-style visual).
// Ranking bar chart + per-user KPI cards with on-time meter and 14-day trend.
// Overdue-now is current-state and does not follow the period selector.

import { Alert, Card, Segmented, Skeleton, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTeamKpi } from '@/hooks/useTeamKpi';
import type { TeamKpiPeriod } from '@/types/teamKpi';
import { TeamRankingChart } from '@/components/team/TeamRankingChart';
import { TeamKpiCard } from '@/components/team/TeamKpiCard';

const { Title, Text } = Typography;
const PERIODS: TeamKpiPeriod[] = ['today', 'week', 'month', 'season'];

export default function TeamKpi() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: TeamKpiPeriod =
    raw && (PERIODS as string[]).includes(raw) ? (raw as TeamKpiPeriod) : 'week';

  const query = useTeamKpi(period);
  const rows = query.data?.results ?? [];

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>{t('team_kpi.title')}</Title>
      <Text type="secondary">{t('team_kpi.subtitle')}</Text>

      {query.isError && (
        <Alert type="error" message={t('team_kpi.load_error')} showIcon style={{ marginTop: 16 }} />
      )}

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <Segmented<TeamKpiPeriod>
          value={period}
          onChange={(v) => setParams({ period: v })}
          options={PERIODS.map((p) => ({ value: p, label: t(`team_kpi.period_${p}`) }))}
        />
      </div>

      {query.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : rows.length === 0 ? (
        <Card size="small"><Text type="secondary">{t('team_kpi.no_users')}</Text></Card>
      ) : (
        <>
          <Card size="small" title={t('team_kpi.ranking_title')} style={{ marginBottom: 16 }}>
            <TeamRankingChart rows={rows} />
          </Card>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12,
          }}>
            {rows.map((row, idx) => (
              <TeamKpiCard key={row.user_id} row={row} rank={idx + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + i18n check**

Run: `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` → clean.
Run the i18n completeness one-liner (extend to cover the new keys) → all three files have every `team_kpi` key.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/teamKpi.ts frontend/src/components/team/ frontend/src/pages/team/TeamKpi.tsx frontend/src/i18n/tk.json frontend/src/i18n/ru.json frontend/src/i18n/en.json
git commit -m "feat(frontend): rebuild team KPI leaderboard as cards + ranking chart + sparklines

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Docs — trend field + visual redesign

**Files:**
- Modify: `.claude/rules/api-contract.md` (add `trend` to the row shape + the fixed-14-day note)
- Modify: `docs/obsidian/` (endpoint + screen doc: note the card/chart/sparkline redesign and the `trend` field)
- Modify: `CHANGELOG.md` (`### Changed`: leaderboard redesigned to cards + ranking chart + sparklines; `trend` added to endpoint)
- Modify: `BUILD_TEST_LOG.md` (prepend a new dated NEEDS TEST entry for the visual redesign)

- [ ] **Step 1: api-contract.md** — in the `team-kpi` row shape, add `"trend": [0,1,0,2,...]` (14 ints, oldest→newest, Asia/Ashgabat days, FIXED window independent of `period`).
- [ ] **Step 2: Obsidian** — update the `screens/team-kpi.md` doc (now cards + ranking bar chart + sparklines, not a table) and the endpoint doc (`trend` field).
- [ ] **Step 3: CHANGELOG** — under `[Unreleased] ### Changed`: "Team KPI leaderboard redesigned: per-user cards, ranking bar chart, 14-day trend sparklines; `trend` added to /core/team-kpi/ rows."
- [ ] **Step 4: BUILD_TEST_LOG** — prepend `- [ ] 2026-07-21 — Team KPI leaderboard VISUAL (cards + ranking chart + sparklines) — NEEDS TEST`.
- [ ] **Step 5: Commit**

```bash
git add .claude/rules/api-contract.md CHANGELOG.md BUILD_TEST_LOG.md docs/obsidian/
git commit -m "docs(p3): document team KPI visual redesign + trend field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Self-Review

- Trend data (backend) → Task 9; consumed by sparkline (Task 10). ✓
- Ranking bar chart single-hue + no legend + direct labels (dataviz) → Task 10 Step 3. ✓
- Cards with on-time meter (numeric label, not color-alone), overdue badge, active hours, medals, avatar → Task 10 Step 4. ✓
- Period switcher + error state preserved → Task 10 Step 5. ✓
- i18n all three langs → Task 10 Step 2. ✓
- Docs → Task 11. ✓
- Type consistency: `trend: number[]` (TS) ↔ `trend: list[int]` len 14 (backend row) ↔ `buildSparkOption(row.trend)`. `ITeamKpiRow` fields match across service/type/card. ✓
- No new deps (ECharts + antd + existing helpers only). ✓
