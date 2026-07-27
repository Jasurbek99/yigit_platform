# "My tasks" Role Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let supervisors filter the **My tasks** page by role, so an admin can see one role's *complete* task list instead of an untagged, silently-truncated mix of all roles.

**Architecture:** Add an optional `?assignee_role=` query param to `/api/v1/me/tasks/` and `/api/v1/me/kpi-today/`, honored only for supervisors. When applied it reuses the exact filter a regular user of that role already gets (`qs.filter(assignee_role=role)`). The frontend adds a supervisor-only role `Select` to the My tasks toolbar and threads the role through both hooks' query keys.

**Tech Stack:** Django 5 + DRF (MSSQL), React 18 + TypeScript + Ant Design + TanStack Query v5, react-i18next.

## Global Constraints

- **Page naming:** **My tasks** = `/me/board` = `pages/me/SelfBoard.tsx`. The separate **Board** page (`/export/shipments/board`, `ShipmentBoard.tsx`) is OUT OF SCOPE and must not be modified.
- **Supervisor set** is defined once, already exists: `_SUPERVISOR_ROLES = frozenset({'export_manager', 'boss', 'admin', 'director'})` in `apps/core/views_me.py:23`, plus `is_superuser`. Do not redefine it.
- **Security invariant:** a non-supervisor sending `?assignee_role=` must NEVER see another role's tasks. The param is ignored for them; their own-role lock is unconditional.
- **Non-goal:** the default all-roles view stays truncated at `page_size=1000` (1270 tasks exist). Do NOT raise the cap. Do NOT claim this plan fixes it.
- **i18n:** every user-visible string needs a key in ALL THREE of `src/i18n/tk.json`, `ru.json`, `en.json` (CLAUDE.md, strict). Never hardcode; never use one language as a placeholder for another.
- **MSSQL:** no JSONField/ArrayField/`distinct('field')`; `bulk_create` needs `batch_size=500`. This plan adds only `.filter()` calls, so no new MSSQL risk.
- **Commits:** one commit per task. Do NOT push. Do NOT commit outside the listed steps.
- **Co-author tag** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/apps/core/views_me.py` | `MeTaskListView` + `MeKpiTodayView`: read + supervisor-gate the param | 1, 2 |
| `backend/apps/export/tests_task_api.py` | Extend `MeTasksTests` / `MeKpiTodayTests` | 1, 2 |
| `frontend/src/hooks/useMyTasks.ts` | Accept role, put it in the query key + URL | 3 |
| `frontend/src/hooks/useMyKpiToday.ts` | Same | 3 |
| `frontend/src/pages/me/SelfBoard.tsx` | Supervisor-only role `Select`, wire to hooks | 4 |
| `frontend/src/i18n/{tk,ru,en}.json` | `me.board.filter_role` key | 4 |
| `.claude/rules/api-contract.md` | Document the new param | 5 |
| `docs/obsidian/` + `CHANGELOG.md` + `BUILD_TEST_LOG.md` | Required by CLAUDE.md | 5 |

Backend before frontend: Task 4 cannot be verified until the API accepts the param.

---

### Task 1: Server-side role filter on `/me/tasks/`

**Files:**
- Modify: `backend/apps/core/views_me.py` (docstring ~40-49; filter block ~86-106)
- Test: `backend/apps/export/tests_task_api.py` (class `MeTasksTests`, ~line 730)

**Interfaces:**
- Consumes: existing `_SUPERVISOR_ROLES` (line 23), existing `is_supervisor` bool (line 65).
- Produces: `GET /api/v1/me/tasks/?assignee_role=<role>` → 200 filtered for supervisors; ignored for others; 400 `{"error": ...}` on unknown role.

**Context you need:** the view currently skips the role filter entirely for supervisors, which is why admins see every role mixed together:

```python
if not is_supervisor:
    qs = qs.filter(assignee_role=role).filter(
        Q(assignee_user__isnull=True) | Q(assignee_user=request.user)
    )
```

Valid role codes come from `apps.core.models.user.ROLE_CHOICES` (a list of `(code, label)` tuples). There are 14: `admin`, `export_manager`, `loading_dept_head`, `loading_dept_head_deputy`, `warehouse_chief`, `weight_master`, `document_team`, `transport`, `sales_rep`, `finansist`, `director`, `accountant`, `greenhouse_manager`, `seller`, `boss`.

- [ ] **Step 1: Write the failing tests**

Append to class `MeTasksTests` in `backend/apps/export/tests_task_api.py`:

```python
    def test_supervisor_can_filter_by_assignee_role(self) -> None:
        client = APIClient()
        _auth(client, self.em_user)
        resp = client.get('/api/v1/me/tasks/?assignee_role=document_team')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.doc_task.pk, ids)
        self.assertNotIn(self.wh_task.pk, ids)

    def test_non_supervisor_cannot_escape_own_role(self) -> None:
        """Security: the param must never widen a regular user's view."""
        client = APIClient()
        _auth(client, self.wh_user)
        resp = client.get('/api/v1/me/tasks/?assignee_role=document_team')
        self.assertEqual(resp.status_code, 200)
        ids = [t['id'] for t in resp.data['results']]
        self.assertNotIn(self.doc_task.pk, ids)
        self.assertIn(self.wh_task.pk, ids)

    def test_supervisor_unknown_role_returns_400(self) -> None:
        client = APIClient()
        _auth(client, self.em_user)
        resp = client.get('/api/v1/me/tasks/?assignee_role=not_a_role')
        self.assertEqual(resp.status_code, 400)

    def test_supervisor_without_param_still_sees_all(self) -> None:
        client = APIClient()
        _auth(client, self.em_user)
        resp = client.get('/api/v1/me/tasks/')
        ids = [t['id'] for t in resp.data['results']]
        self.assertIn(self.wh_task.pk, ids)
        self.assertIn(self.doc_task.pk, ids)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python manage.py test apps.export.tests_task_api.MeTasksTests -v 2
```

Expected: `test_supervisor_can_filter_by_assignee_role` FAILS (`doc_task` and `wh_task` both returned — param ignored) and `test_supervisor_unknown_role_returns_400` FAILS (got 200). The other two PASS already — they pin existing behavior so you don't regress it.

- [ ] **Step 3: Implement the filter**

In `backend/apps/core/views_me.py`, replace the `if not is_supervisor:` block (~line 86) with:

```python
        if not is_supervisor:
            # Regular users: their role's shipment tasks (assignee_user null) plus
            # any task personally assigned to them (e.g. their own weekly_plan task).
            # NOTE: ?assignee_role= is deliberately ignored here — a regular user
            # must never be able to widen their view to another role's work.
            qs = qs.filter(assignee_role=role).filter(
                Q(assignee_user__isnull=True) | Q(assignee_user=request.user)
            )
        else:
            # Supervisors see every role by default; ?assignee_role= narrows to one.
            # Fetching the role as its own query makes the result complete, rather
            # than a slice of the (capped) all-roles payload.
            #
            # Deliberately NO assignee_user clause here: unlike a regular user of
            # role X — who also filters assignee_user IS NULL OR = self — a
            # supervisor sees role-X tasks another user has personally picked up.
            # That is the oversight semantic we want ("what is this role sitting
            # on?"), and it makes this view a superset of that role's own screen.
            # See docs/superpowers/specs/2026-07-16-selfboard-role-filter-design.md
            role_param = request.query_params.get('assignee_role')
            if role_param:
                from apps.core.models.user import ROLE_CHOICES

                if role_param not in {code for code, _ in ROLE_CHOICES}:
                    return Response(
                        {'error': f'Unknown role: {role_param}'},
                        status=400,
                    )
                qs = qs.filter(assignee_role=role_param)
```

Update the class docstring (~line 45) to list the new param:

```python
    Supports the same filters as the main TaskViewSet:
        ?state=open
        ?step=yuklenme
        ?overdue=true
        ?assignee_role=warehouse_chief   — supervisors only; ignored for other
            roles, who are always locked to their own. Unknown role → 400.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && python manage.py test apps.export.tests_task_api.MeTasksTests -v 2
```

Expected: OK, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/views_me.py backend/apps/export/tests_task_api.py
git commit -m "$(cat <<'EOF'
feat(p3): add supervisor-only ?assignee_role= filter to /me/tasks/

Supervisors previously saw every role's tasks mixed together in one
untagged list, truncated at page_size=1000 (1270 tasks exist). The param
fetches a single role as its own query (~574 rows at worst), so the
filtered view is complete rather than a slice of a capped payload.

The supervisor view is a superset of that role's own screen: no
assignee_user clause, so personally picked-up tasks are included too.

Ignored for non-supervisors — their own-role lock is unconditional.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Role-aware KPI on `/me/kpi-today/`

**Files:**
- Modify: `backend/apps/core/views_me.py` (`MeKpiTodayView`, ~119-199)
- Test: `backend/apps/export/tests_task_api.py` (class `MeKpiTodayTests`, ~line 791)

**Interfaces:**
- Consumes: `_SUPERVISOR_ROLES`, `_compute_kpi(user)` from Task 1's file.
- Produces: `_compute_kpi(user, role: str | None = None)` — when `role` is None it falls back to `user.role`, preserving every existing caller. `GET /me/kpi-today/?assignee_role=<role>`.

**Why:** `_compute_kpi` hardcodes `assignee_role=getattr(user, 'role', None)`. Without this, an admin viewing the warehouse role sees warehouse tasks under their own empty KPI tiles — reads as a bug.

**Cache trap:** the key is `f'me:kpi-today:{request.user.id}'`. If the role isn't in the key, an admin switching roles gets the previous role's numbers for 60s. The key MUST include the effective role.

**Existing test depends on the literal key — you MUST update it.** `test_caching_avoids_second_query` (~line 866) opens with

```python
cache.delete(f'me:kpi-today:{self.user.id}')
```

After the key change that line deletes a key that no longer exists. The test would still pass — but only by luck, having quietly lost its isolation from cache state left by earlier tests. Step 3b below fixes it. Do not skip it because the suite is green.

- [ ] **Step 1: Write the failing tests**

Append to class `MeKpiTodayTests`:

```python
    def test_supervisor_kpi_follows_assignee_role(self) -> None:
        em_user = _make_user('kpi_em', 'export_manager')
        done = _make_task(
            shipment=self.shipment,
            assignee_role='warehouse_chief',
            state=TaskState.DONE,
        )
        done.completed_at = timezone.now()
        done.save()

        client = APIClient()
        _auth(client, em_user)
        # Own role (export_manager) has no done tasks today.
        resp_own = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp_own.data['done_count'], 0)
        # Viewing warehouse_chief must surface that role's completed task.
        resp_wh = client.get('/api/v1/me/kpi-today/?assignee_role=warehouse_chief')
        self.assertEqual(resp_wh.data['done_count'], 1)
        done.delete()

    def test_non_supervisor_kpi_ignores_assignee_role(self) -> None:
        done = _make_task(
            shipment=self.shipment,
            assignee_role='document_team',
            state=TaskState.DONE,
        )
        done.completed_at = timezone.now()
        done.save()

        client = APIClient()
        _auth(client, self.user)  # warehouse_chief
        resp = client.get('/api/v1/me/kpi-today/?assignee_role=document_team')
        self.assertEqual(resp.data['done_count'], 0)
        done.delete()
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && python manage.py test apps.export.tests_task_api.MeKpiTodayTests -v 2
```

Expected: `test_supervisor_kpi_follows_assignee_role` FAILS — `resp_wh.data['done_count']` is 0, not 1 (param ignored).

- [ ] **Step 3: Implement**

In `MeKpiTodayView.get`, replace the body:

```python
    def get(self, request):
        role = self._effective_role(request)
        cache_key = f'me:kpi-today:{request.user.id}:{role}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        result = self._compute_kpi(request.user, role)
        cache.set(cache_key, result, _KPI_CACHE_TTL)
        return Response(result)

    @staticmethod
    def _effective_role(request) -> str | None:
        """Role whose KPI to report.

        Supervisors may pass ?assignee_role= to follow the role they are
        viewing on the My tasks page; everyone else always gets their own.
        Mirrors the gate in MeTaskListView so the tiles and the columns
        below them always describe the same role.
        """
        user_role = getattr(request.user, 'role', None)
        is_supervisor = (
            getattr(request.user, 'is_superuser', False)
            or user_role in _SUPERVISOR_ROLES
        )
        if not is_supervisor:
            return user_role
        return request.query_params.get('assignee_role') or user_role
```

Change `_compute_kpi` to take the role (signature + the one filter line):

```python
    @staticmethod
    def _compute_kpi(user, role: str | None = None) -> dict:
        """Compute today's KPI metrics from completed tasks.

        Args:
            user: the requesting user.
            role: role to report on; defaults to the user's own role.
        """
        from apps.export.models import Task, TaskState

        if role is None:
            role = getattr(user, 'role', None)

        midnight = _today_midnight_utc()
        today_tasks = list(
            Task.objects.filter(
                assignee_role=role,
                state=TaskState.DONE,
                completed_at__gte=midnight,
            ).only('started_at', 'completed_at', 'deadline')
        )
```

Leave the rest of `_compute_kpi` (from `done_count = len(today_tasks)` down) exactly as it is.

Note: no role validation here. An unknown role yields an empty KPI, which is harmless — and `/me/tasks/` already 400s on it, so the UI can never reach this state.

- [ ] **Step 3b: Repair the existing caching test's literal key**

In `test_caching_avoids_second_query` (~line 870), the cache key must match the view's new format or the test stops isolating itself:

```python
        cache.delete(f'me:kpi-today:{self.user.id}:{self.user.role}')
```

`self.user` is a `warehouse_chief` (non-supervisor), so its effective role is always its own — the key is stable and the test's intent is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && python manage.py test apps.export.tests_task_api.MeKpiTodayTests -v 2
```

Expected: OK.

To prove Step 3b actually matters rather than trusting a green suite, run the caching test in isolation and then as part of the class — both must pass:

```bash
cd backend && python manage.py test apps.export.tests_task_api.MeKpiTodayTests.test_caching_avoids_second_query -v 2
```

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/views_me.py backend/apps/export/tests_task_api.py
git commit -m "$(cat <<'EOF'
feat(p3): make /me/kpi-today/ follow ?assignee_role= for supervisors

Keeps the My tasks KPI tiles coherent with the role being viewed. Cache
key now includes the effective role so switching roles cannot serve the
previous role's numbers for the 60s TTL.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Thread the role through both hooks

**Files:**
- Modify: `frontend/src/hooks/useMyTasks.ts`
- Modify: `frontend/src/hooks/useMyKpiToday.ts`

**Interfaces:**
- Consumes: Tasks 1-2's `?assignee_role=` param.
- Produces: `useMyTasks({ role?, enabled? })` and `useMyKpiToday(role?: string | null)`. Every field is optional, so the existing calls — `useMyTasks({ enabled: !!user })` in `AppLayout.tsx:65`, `useMyTasks()` / `useMyKpiToday()` in `SelfBoard.tsx` — keep compiling **unchanged**.

**Critical:** the role MUST be in the TanStack Query key. Without it, switching roles shows the previous role's cached tasks under the new role's name.

**Signature note — do not "improve" this.** `useMyTasks` already takes `options: { enabled?: boolean }` as its FIRST parameter, and `AppLayout.tsx:65` (the nav badge) calls `useMyTasks({ enabled: !!user })`. Add `role` INTO that existing object rather than adding a positional first param — a positional `role` would silently capture `{ enabled: ... }` at that call site and drag an unrelated file into this diff. `useMyKpiToday` currently takes no arguments, so a plain positional `role` is the natural fit there. The two hooks differ because their existing shapes differ; that is intentional.

- [ ] **Step 1: Update `useMyTasks`**

Replace the `useMyTasks` function in `frontend/src/hooks/useMyTasks.ts`:

```typescript
export function useMyTasks(
  options: { enabled?: boolean; role?: string | null } = {},
) {
  const { enabled, role = null } = options;
  return useQuery<IMyTasksResponse>({
    enabled: enabled ?? true,
    // role is part of the key: without it, switching roles would show the
    // previous role's cached tasks under the new role's name.
    queryKey: ['my-tasks', role],
    queryFn: async () => {
      // page_size=1000: the My tasks page renders ALL tasks (active +
      // done-today + history) from this single fetch, so the cap must clear a
      // role's full per-season backlog or the newest tasks silently drop off.
      // Backed by TaskBoardPagination (max 2000) on /me/tasks/.
      // Supervisors with no role selected still exceed this cap (1270 tasks
      // as of 2026-07: all roles combined) — selecting a role is what makes
      // the view complete, since the largest single role is ~574.
      const params = new URLSearchParams({ page_size: '1000' });
      if (role) params.set('assignee_role', role);
      const { data } = await api.get(`/me/tasks/?${params.toString()}`);
      return data;
    },
    // Polls app-wide (AppLayout nav badge). 60s halves the steady-state
    // request rate vs 30s; the interval auto-pauses while the tab is
    // backgrounded (refetchIntervalInBackground defaults to false in v5).
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 2: Update `useMyKpiToday`**

Replace the `useMyKpiToday` function in `frontend/src/hooks/useMyKpiToday.ts`:

```typescript
export function useMyKpiToday(role?: string | null) {
  return useQuery<IMyKpiToday>({
    queryKey: ['me', 'kpi-today', role ?? null],
    queryFn: async () => {
      const qs = role ? `?assignee_role=${encodeURIComponent(role)}` : '';
      const { data } = await api.get(`/me/kpi-today/${qs}`);
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 3: Verify existing callers still typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors. (`npm run type-check` is broken with TS5103 in this repo — use the command above.)

Every field is optional, so all three existing call sites are unaffected and **no other file should change in this task**:

| Call site | Status |
|---|---|
| `AppLayout.tsx:65` — `useMyTasks({ enabled: !!user })` | still valid; `role` defaults to null |
| `SelfBoard.tsx:239` — `useMyTasks()` | still valid (Task 4 rewrites it) |
| `SelfBoard.tsx:240` — `useMyKpiToday()` | still valid (Task 4 rewrites it) |

If `git status` shows any file other than the two hooks, you changed too much — revert it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useMyTasks.ts frontend/src/hooks/useMyKpiToday.ts
git commit -m "$(cat <<'EOF'
feat(frontend): thread optional role through useMyTasks/useMyKpiToday

Role is part of the query key so each role caches independently and
switching back is instant.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Supervisor-only role Select on the My tasks page

**Files:**
- Modify: `frontend/src/pages/me/SelfBoard.tsx` (hooks ~239-255; toolbar ~395-435)
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json`

**Interfaces:**
- Consumes: `useMyTasks(role)` / `useMyKpiToday(role)` (Task 3); `ROLE_CHOICES` from `@/constants/roles` (`{ value: string; labelKey: string }[]`, 14 roles, `labelKey` → existing `roles.*` keys); `useAuth()` → `user: ICurrentUser | null` with `.role` and `.is_superuser`.
- Produces: none (leaf).

**Do not touch** the kanban columns, drag-drop, drawer, or the done-today/history split — they consume `ITaskListItem[]` unchanged.

- [ ] **Step 1: Add the supervisor constant and role state**

In `SelfBoard.tsx`, add near the top-level constants (beside `PHASE_OPTIONS`, ~line 49):

```typescript
// Mirrors _SUPERVISOR_ROLES in backend/apps/core/views_me.py — these roles
// receive every role's tasks, so only they get the role switcher.
const SUPERVISOR_ROLES: readonly string[] = [
  'export_manager',
  'boss',
  'admin',
  'director',
];
```

Add the import beside the other `@/constants` / `@/types` imports:

```typescript
import { ROLE_CHOICES } from '@/constants/roles';
```

Inside the component, replace lines 239-241:

```typescript
  const [roleFilter, setRoleFilter] = useState<string | null>(null);

  const isSupervisor =
    !!user && (user.is_superuser || SUPERVISOR_ROLES.includes(user.role));

  // A non-supervisor can never set roleFilter (the Select is not rendered),
  // and the backend ignores the param for them regardless.
  const { data: tasksData, isLoading: tasksLoading, isError: tasksError } =
    useMyTasks({ role: roleFilter });
  const { data: kpi, isLoading: kpiLoading } = useMyKpiToday(roleFilter);
  const unblockTask = useUnblockTask();
```

Keep the existing `const [phaseFilter, ...]`, `searchText`, `showAll` declarations at ~253-255 as they are.

- [ ] **Step 2: Add the Select to the toolbar**

In the `{/* Filters */}` block, insert immediately BEFORE the existing phase `<Select>` (~line 405):

```tsx
        {isSupervisor && (
          <Select<string | null>
            value={roleFilter}
            onChange={(v) => setRoleFilter(v ?? null)}
            allowClear
            placeholder={t('me.board.filter_role')}
            style={{ width: 180 }}
            options={ROLE_CHOICES.map((r) => ({
              value: r.value,
              label: t(r.labelKey),
            }))}
          />
        )}
```

- [ ] **Step 3: Add the i18n key to all three locales**

Add `filter_role` inside the existing `me.board` object in each file — next to the existing `filter_phase` key:

`src/i18n/en.json`:
```json
      "filter_role": "All roles",
```
`src/i18n/ru.json`:
```json
      "filter_role": "Все роли",
```
`src/i18n/tk.json`:
```json
      "filter_role": "Ähli rollar",
```

It reads as the placeholder shown when nothing is selected, which is exactly the state it describes: all roles.

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0
```

Expected: no errors.

- [ ] **Step 5: Verify in the running app**

Start the app, log in as an admin, open **My tasks** (left nav). Confirm:
1. A role dropdown appears left of the phase filter.
2. Selecting **Document Team** shows only that role's cards, and the network tab shows `/me/tasks/?page_size=1000&assignee_role=document_team`.
3. The KPI tiles change when the role changes.
4. Clearing the dropdown restores all roles.
5. Log in as a non-supervisor (e.g. a `warehouse_chief`) — the dropdown must NOT render.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/me/SelfBoard.tsx frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "$(cat <<'EOF'
feat(frontend): add supervisor-only role filter to the My tasks page

Admins previously saw every role's tasks in one untagged list. Selecting
a role now narrows server-side, so the view is complete rather than a
slice of the capped all-roles payload. KPI tiles follow the selection.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentation

**Files:**
- Modify: `.claude/rules/api-contract.md`
- Modify: `CHANGELOG.md`
- Modify: `BUILD_TEST_LOG.md`
- Modify/Create: the My tasks page doc under `docs/obsidian/` (find it first — see Step 3)

CLAUDE.md requires the Obsidian vault, CHANGELOG, and BUILD_TEST_LOG to be updated for any feature change. This is not optional.

- [ ] **Step 1: Document the API param**

Add to `.claude/rules/api-contract.md` (near the other task/me endpoints; if no `/me/tasks/` section exists, create one):

```markdown
### My tasks: `GET /api/v1/me/tasks/` and `GET /api/v1/me/kpi-today/`

Backs the **My tasks** page (`/me/board`). Regular users are locked to their own
`assignee_role`; supervisors (`export_manager`, `boss`, `admin`, `director`, superusers)
receive every role's tasks by default.

Optional `?assignee_role=<role>` narrows to one role. **Supervisors only** — the param is
silently ignored for every other role, whose own-role lock is unconditional. An unknown
role returns 400 on `/me/tasks/`.

`/me/kpi-today/` accepts the same param under the same gate, so the KPI tiles describe the
role being viewed. Its 60s cache key includes the effective role.

Caution: with no role selected, a supervisor's list is truncated at `page_size=1000`
(1270 tasks exist as of 2026-07). Selecting a role makes the view complete — the largest
single role is ~574.
```

- [ ] **Step 2: Update CHANGELOG.md**

Under `## [Unreleased]` → `### Added`:

```markdown
- My tasks page: supervisor-only role filter; `?assignee_role=` on `/me/tasks/` + `/me/kpi-today/` (feat(p3), feat(frontend))
```

- [ ] **Step 3: Update the Obsidian doc**

Find the right doc first:

```bash
grep -rl "me/board\|My tasks\|SelfBoard" docs/obsidian/ | head
```

Update the page it names with: the role filter, who sees it (supervisors only), that filtering is server-side, and the truncation caveat for the unfiltered view. If no doc matches, create `docs/obsidian/features/my-tasks.md` and add it to `docs/obsidian/00-index.md`.

- [ ] **Step 4: Append to BUILD_TEST_LOG.md**

Newest on top:

```markdown
- [ ] 2026-07-16 — My tasks role filter (supervisor-only Select + server-side ?assignee_role= on /me/tasks/ and /me/kpi-today/) — NEEDS TEST
```

Leave it unchecked. Only the user checks it off, after they test.

- [ ] **Step 5: Run the full task test suite**

```bash
cd backend && python manage.py test apps.export.tests_task_api -v 2
```

Expected: OK. Report the actual count.

Note: the wider suite has ~71 pre-existing failures in 4 unrelated buckets — do not treat those as caused by this work, and do not try to fix them here.

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/api-contract.md CHANGELOG.md BUILD_TEST_LOG.md docs/obsidian/
git commit -m "$(cat <<'EOF'
docs: document the My tasks role filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Server-side `?assignee_role=` on `/me/tasks/`, supervisor-gated | 1 |
| Regular users cannot escape own-role lock | 1 (explicit security test) |
| Unknown role → 400 | 1 |
| KPI follows selected role | 2 |
| KPI cache key includes role | 2 |
| Supervisor-only role `Select` | 4 |
| Role in TanStack query key | 3 |
| `ROLE_CHOICES` for options | 4 |
| i18n in tk/ru/en | 4 |
| Board page untouched | Global Constraints + no task touches `ShipmentBoard.tsx` |
| All-roles truncation NOT "fixed" | Global Constraints; comment in Task 3 states it plainly |

No gaps.

**Placeholder scan:** none — every code step carries real code, every command is exact.

**Type consistency:** `useMyTasks({ role: roleFilter })` in Task 4 matches `useMyTasks(options: { enabled?; role? })` in Task 3. `useMyKpiToday(roleFilter)` matches `useMyKpiToday(role?: string | null)`. `_compute_kpi(user, role=None)` (Task 2) keeps its default, so no existing caller breaks. `roleFilter: string | null` matches both `ROLE_CHOICES[].value: string` and the hooks' `string | null`.

**Verified against the real code, not assumed:**
- All three hook call sites enumerated via grep (`AppLayout.tsx:65`, `SelfBoard.tsx:239-240`) — the additive options-object change breaks none of them. An earlier draft of this plan added `role` as a positional first param, which would have silently broken the `AppLayout` nav badge; that is why the signature is shaped this way.
- `_SUPERVISOR_ROLES` (`views_me.py:23`) and `ROLE_CHOICES` (`core/models/user.py:5`, 14 roles) both read directly.
- Task counts (1270 total / 574 largest role) measured against the live DB on 2026-07-16, not estimated.

**Known gap — accepted, not an oversight:** there is no frontend test asserting the `Select` is hidden for non-supervisors (Task 4 Step 5 covers it manually). This repo has no component-test harness for `SelfBoard`, and standing one up is far outside this feature's scope. The security-relevant half of that behavior is covered server-side by `test_non_supervisor_cannot_escape_own_role` — the UI gate is cosmetic; the backend gate is the real one.
