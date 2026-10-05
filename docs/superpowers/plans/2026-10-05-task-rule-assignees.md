# Task Rule Assignees + Colleagues' Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin picks 1+ users of a role per TaskRule; only they see that rule's tasks in "My tasks"; everyone else of the role sees them under a "Colleagues' tasks" tab and can still do them.

**Architecture:** New `export.TaskRuleAssignee` (rule, user) table. Visibility is resolved live from `Task.rule` → assignees at query time (no snapshot on Task). `MeTaskListView` gains an assignee clause for regular users and a `?scope=colleagues` mode. `TaskRuleViewSet` gains two actions: `assignees` (PUT) and `assignee-candidates` (GET).

**Tech Stack:** Django 5 + DRF on MSSQL; React + TS + Ant Design + TanStack Query; vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-task-rule-assignees-design.md`

## Global Constraints

- MSSQL: no JSONField/ArrayField, no `.distinct('x')`; use `Exists()` subqueries, not joins + distinct.
- Migration: `backend/apps/export/migrations/0094_taskruleassignee.py` — **re-check free** first: `ls backend/apps/export/migrations/ | tail -3` and `git log --oneline origin/main -5`.
- After `makemigrations`, run `python manage.py migrate export` and confirm with `showmigrations export`.
- `models/` package: re-export the new model from `backend/apps/export/models/__init__.py`.
- Only TaskRule-generated tasks are affected (`Task.rule IS NOT NULL`). Code-generated kinds unchanged.
- Supervisors (`boss`, `admin`, `director`, export_manager-like minus document_team, superuser) — `/me/tasks/` behaviour unchanged; `?scope=` ignored for them.
- `MeKpiTodayView` unchanged.
- Assignee edit permission: superuser, `admin`, `director`.
- Allowed assignees: active users with `role in task_roles_for(rule.assignee_role)`.
- UI copy never says "draft"/"черновик". i18n keys in `ru.json`, `en.json`, `tk.json`.
- **Git: do NOT commit unless the user has said "commit".** Commit steps below are run only after that. Before any commit: `git status` + `git diff --cached`, add explicit paths only (shared tree with other sessions).
- Backend tests: if another `manage.py test` run is active, override the test DB name (shared `test_YIGIT_PLATFROM` deadlocks).
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).

## Review Focus

1. A user who is an assignee of rule A but not rule B (same role) — sees A's tasks in My tasks and B's tasks in Colleagues, never both lists for one task. (Task 2 test `test_mine_and_colleagues_partition`)
2. Deputy equivalence: `loading_dept_head_deputy` assigned to a `loading_dept_head` rule sees it as "mine"; the head sees it under Colleagues. (Task 1 + Task 2 tests)
3. Assignee deactivated or moved to another role → only *valid* assignees (active, role in the caller's equivalent roles) count; a rule whose named users are all gone falls back to "whole role" (back in everyone's "mine"). Pinned by `test_inactive_assignee_falls_back_to_role` and `test_role_changed_assignee_falls_back_to_role`. (Task 2)

Verified while planning: all three rule-driven creation paths pass `rule=rule` (`task_rules.py:251`, `task_rules.py:529`, `task_chain.py:113`). `seed_task_rules` uses `update_or_create`, so assignees survive a reseed; only `--reset` deletes rules (and with them assignees via CASCADE).
4. PUT with empty list → back to "whole role". (Task 1 test `test_put_empty_list_clears`)
5. Garawul gate filter still applies under `scope=colleagues`. (Task 2 test `test_colleagues_scope_keeps_gate_filter`)

---

### Task 1: TaskRuleAssignee model + admin endpoints

**Files:**
- Modify: `backend/apps/export/models/task.py` (add class after `TaskRule`)
- Modify: `backend/apps/export/models/__init__.py:55`
- Create: `backend/apps/export/migrations/0094_taskruleassignee.py` (via makemigrations)
- Modify: `backend/apps/export/serializers.py` (`TaskRuleSerializer`, ~L2705)
- Modify: `backend/apps/export/views.py` (`TaskRuleViewSet`, ~L5044)
- Modify: `backend/apps/export/permissions.py` (add `CanEditTaskRuleAssignees`)
- Test: `backend/apps/export/tests_task_rule_assignees.py` (new)

**Interfaces:**
- Produces: `TaskRuleAssignee(rule: FK TaskRule related_name='assignees', user: FK core.User related_name='+')`
- Produces: `TaskRule` JSON gains `assignees: [{id: int, full_name: str}]`
- Produces: `PUT /api/v1/export/task-rules/{id}/assignees/` body `{"user_ids": [int]}` → 200 with the updated rule
- Produces: `GET /api/v1/export/task-rules/{id}/assignee-candidates/` → `[{id, full_name, role}]`

- [ ] **Step 1: Write the failing tests** — `backend/apps/export/tests_task_rule_assignees.py`

```python
"""TaskRule assignees: model, PUT /assignees/, GET /assignee-candidates/."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import RolePagePermission, User
from apps.export.models import AuditLog, TaskRule, TaskRuleAssignee


def _make_user(username, role, is_superuser=False, is_active=True, first_name=''):
    user = User(username=username, role=role, is_superuser=is_superuser,
                is_active=is_active, first_name=first_name)
    user.set_password('pass')
    user.save()
    return user


class TaskRuleAssigneesApiTests(TestCase):
    def setUp(self):
        cache.clear()
        for role in ('admin', 'director', 'warehouse_chief'):
            RolePagePermission.objects.update_or_create(
                role=role, page_code='export.task_rules', defaults={'is_visible': True},
            )
        cache.clear()
        self.client = APIClient()
        self.rule = TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head',
        )
        self.admin = _make_user('ta_admin', 'admin')
        self.head1 = _make_user('ta_head1', 'loading_dept_head', first_name='Ahmed')
        self.head2 = _make_user('ta_head2', 'loading_dept_head')
        self.deputy = _make_user('ta_dep', 'loading_dept_head_deputy')
        self.other = _make_user('ta_wh', 'warehouse_chief')
        self.url = f'/api/v1/export/task-rules/{self.rule.pk}/assignees/'

    def test_list_includes_empty_assignees(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/v1/export/task-rules/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data[0]['assignees'], [])

    def test_admin_sets_assignees(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [self.head1.pk, self.deputy.pk]}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(
            set(TaskRuleAssignee.objects.filter(rule=self.rule).values_list('user_id', flat=True)),
            {self.head1.pk, self.deputy.pk},
        )
        self.assertEqual({a['id'] for a in resp.data['assignees']}, {self.head1.pk, self.deputy.pk})
        self.assertTrue(AuditLog.objects.filter(model_name='TaskRule', object_id=self.rule.pk).exists())

    def test_put_replaces_list(self):
        TaskRuleAssignee.objects.create(rule=self.rule, user=self.head1)
        self.client.force_authenticate(self.admin)
        self.client.put(self.url, {'user_ids': [self.head2.pk]}, format='json')
        self.assertEqual(
            list(TaskRuleAssignee.objects.filter(rule=self.rule).values_list('user_id', flat=True)),
            [self.head2.pk],
        )

    def test_put_empty_list_clears(self):
        TaskRuleAssignee.objects.create(rule=self.rule, user=self.head1)
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': []}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(TaskRuleAssignee.objects.filter(rule=self.rule).exists())

    def test_rejects_user_of_other_role(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [self.other.pk]}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn(str(self.other.pk), str(resp.data))
        self.assertFalse(TaskRuleAssignee.objects.exists())

    def test_rejects_inactive_user(self):
        gone = _make_user('ta_gone', 'loading_dept_head', is_active=False)
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.url, {'user_ids': [gone.pk]}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_forbidden(self):
        self.client.force_authenticate(self.other)
        resp = self.client.put(self.url, {'user_ids': []}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_director_allowed(self):
        self.client.force_authenticate(_make_user('ta_dir', 'director'))
        resp = self.client.put(self.url, {'user_ids': [self.head1.pk]}, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_candidates_are_active_role_users_incl_deputy(self):
        _make_user('ta_gone2', 'loading_dept_head', is_active=False)
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f'/api/v1/export/task-rules/{self.rule.pk}/assignee-candidates/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            {c['id'] for c in resp.data},
            {self.head1.pk, self.head2.pk, self.deputy.pk},
        )
        ahmed = next(c for c in resp.data if c['id'] == self.head1.pk)
        self.assertEqual(ahmed['full_name'], 'Ahmed')
```

- [ ] **Step 2: Run tests, verify they fail**

Run (from `backend/`): `python manage.py test apps.export.tests_task_rule_assignees --verbosity=1`
Expected: ImportError `cannot import name 'TaskRuleAssignee'`.

- [ ] **Step 3: Add the model** — in `backend/apps/export/models/task.py`, right after `class TaskRule` ends (before `class Task`):

```python
class TaskRuleAssignee(models.Model):
    """A specific user who owns a TaskRule's tasks.

    No rows for a rule = the whole role owns it (the default). With rows, only
    these users see the rule's tasks under "My tasks"; the rest of the role see
    them under "Colleagues' tasks" and may still act on them. Read live through
    Task.rule, so editing the list re-routes already-open tasks immediately.
    """

    rule = models.ForeignKey(TaskRule, on_delete=models.CASCADE, related_name='assignees')
    user = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'export_task_rule_assignee'
        constraints = [
            models.UniqueConstraint(fields=['rule', 'user'], name='uniq_task_rule_assignee'),
        ]

    def __str__(self) -> str:
        return f'{self.rule_id} → {self.user_id}'
```

Update `backend/apps/export/models/__init__.py:55`:

```python
from .task import Task, TaskRule, TaskRuleAssignee, TaskState, TaskCompletionRule, TaskKind, TaskCancelReason
```

(If `__init__.py` has an `__all__`, add `'TaskRuleAssignee'` there too.)

- [ ] **Step 4: Migration**

Check the number is free, then (from `backend/`):
```
python manage.py makemigrations export --name taskruleassignee
python manage.py migrate export
python manage.py showmigrations export | tail -3
```
Expected: `[X] 0094_taskruleassignee`.

- [ ] **Step 5: Permission class** — append to `backend/apps/export/permissions.py`:

```python
class CanEditTaskRuleAssignees(BasePermission):
    """Who may change a TaskRule's assignee list: superuser, admin, director.

    Same set as task cancel (_CANCEL_ROLES) — re-routing a role's work is an
    admin decision, not something the role itself configures.
    """

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.is_superuser or getattr(user, 'role', None) in _CANCEL_ROLES
```

- [ ] **Step 6: Serializer** — in `TaskRuleSerializer` (`backend/apps/export/serializers.py` ~L2705) add the field, add `'assignees'` to `Meta.fields`, and the method:

```python
    assignees = serializers.SerializerMethodField()
```
```python
    def get_assignees(self, obj) -> list[dict]:
        # prefetch_related('assignees__user') in the viewset keeps this query-free.
        return [
            {'id': a.user_id, 'full_name': a.user.get_full_name() or a.user.username}
            for a in obj.assignees.all()
        ]
```

- [ ] **Step 7: Viewset actions** — in `TaskRuleViewSet` (`backend/apps/export/views.py` ~L5044):

Change `get_queryset` first line to:
```python
        qs = TaskRule.objects.prefetch_related('assignees__user').all()
```

Add the two actions (imports: `action` from `rest_framework.decorators`, `transaction` from `django.db` — reuse if already imported at module top):

```python
    @action(detail=True, methods=['put'], url_path='assignees',
            permission_classes=[IsAuthenticated, CanEditTaskRuleAssignees])
    def set_assignees(self, request, pk=None):
        """PUT {"user_ids": [..]} — replace the rule's assignee list. [] = whole role."""
        from apps.core.models import User
        from apps.core.roles import task_roles_for
        from apps.export.models import AuditLog, TaskRuleAssignee

        rule = self.get_object()
        user_ids = request.data.get('user_ids')
        if not isinstance(user_ids, list) or not all(isinstance(i, int) for i in user_ids):
            return Response({'error': 'user_ids must be a list of integers'}, status=400)
        user_ids = sorted(set(user_ids))
        allowed = set(User.objects.filter(
            pk__in=user_ids, is_active=True,
            role__in=task_roles_for(rule.assignee_role),
        ).values_list('pk', flat=True))
        bad = [i for i in user_ids if i not in allowed]
        if bad:
            return Response(
                {'error': f'Users not allowed for role {rule.assignee_role}: {bad}'},
                status=400,
            )
        old_ids = sorted(rule.assignees.values_list('user_id', flat=True))
        with transaction.atomic():
            rule.assignees.all().delete()
            for uid in user_ids:  # a handful of rows — no bulk_create needed
                TaskRuleAssignee.objects.create(rule=rule, user_id=uid)
            AuditLog.objects.create(
                user=request.user, action='update', model_name='TaskRule',
                object_id=rule.pk, object_repr=str(rule)[:200], field_name='assignees',
                old_value=','.join(map(str, old_ids)), new_value=','.join(map(str, user_ids)),
                detail='Task rule assignees changed',
            )
        rule = self.get_queryset().get(pk=rule.pk)
        return Response(self.get_serializer(rule).data)

    @action(detail=True, methods=['get'], url_path='assignee-candidates',
            permission_classes=[IsAuthenticated, CanEditTaskRuleAssignees])
    def assignee_candidates(self, request, pk=None):
        """Active users who may be assigned to this rule (its role + equivalents)."""
        from apps.core.models import User
        from apps.core.roles import task_roles_for

        rule = self.get_object()
        users = User.objects.filter(
            is_active=True, role__in=task_roles_for(rule.assignee_role),
        ).order_by('first_name', 'username')
        return Response([
            {'id': u.pk, 'full_name': u.get_full_name() or u.username, 'role': u.role}
            for u in users
        ])
```

Import `CanEditTaskRuleAssignees` next to `CanViewTaskRules` in views.py. Check `AuditLog` field names (`old_value`, `new_value`, `field_name`) against `backend/apps/export/models/audit.py` before running; drop any that don't exist.

- [ ] **Step 8: Run tests, verify pass**

Run: `python manage.py test apps.export.tests_task_rule_assignees apps.export.tests_task_rules_api --verbosity=1`
Expected: all OK (existing rules API tests must still pass — the response gained a field only).

Also: `python manage.py makemigrations --check --dry-run` → "No changes detected".

- [ ] **Step 9: Docs** — `docs/obsidian/reference/task-rules.md`: add an "Assignees" section (table `export_task_rule_assignee`, live lookup, empty = whole role, the two endpoints, who may edit).

- [ ] **Step 10: Commit (only after user says "commit")**

```bash
git status && git diff --cached
git add backend/apps/export/models/task.py backend/apps/export/models/__init__.py \
  backend/apps/export/migrations/0094_taskruleassignee.py backend/apps/export/serializers.py \
  backend/apps/export/views.py backend/apps/export/permissions.py \
  backend/apps/export/tests_task_rule_assignees.py docs/obsidian/reference/task-rules.md
git commit -m "feat(p3): task rule assignees — model + admin endpoints"
```

---

### Task 2: My tasks visibility + `?scope=colleagues`

**Files:**
- Modify: `backend/apps/core/views_me.py` (`MeTaskListView.get`, regular-user branch ~L160-175)
- Test: `backend/apps/export/tests_task_rule_assignees.py` (append class)

**Interfaces:**
- Consumes: `TaskRuleAssignee` (Task 1)
- Produces: `GET /api/v1/me/tasks/?scope=colleagues` — role's tasks whose rule has assignees and the caller is not one of them. Any other `scope` value / absent = "mine".

- [ ] **Step 1: Write the failing tests** — append to `backend/apps/export/tests_task_rule_assignees.py`:

```python
from apps.core.models import LoadingLocation, Season, ShipmentStatusType
from apps.export.models import Shipment, Task, TaskCompletionRule, TaskState


def _shipment(code='TA001'):
    season, _ = Season.objects.get_or_create(
        name='ta-season',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='yuklenme',
        defaults={'name_tk': 'y', 'name_en': 'y', 'step_order': 1, 'phase': 'LOADING'},
    )
    return Shipment.objects.get_or_create(
        shipment_code=code, defaults={'date': '2026-01-15', 'season': season, 'status': status},
    )[0]


def _task(rule, role='loading_dept_head', **kw):
    return Task.objects.create(
        shipment=_shipment(), step='yuklenme', title_key=rule.title_key if rule else 'x',
        rule=rule, assignee_role=role, completion_rule=TaskCompletionRule.MANUAL_DONE,
        state=TaskState.OPEN, **kw,
    )


class MeTasksAssigneeVisibilityTests(TestCase):
    URL = '/api/v1/me/tasks/'

    def setUp(self):
        cache.clear()
        self.head1 = _make_user('tv_head1', 'loading_dept_head')
        self.head2 = _make_user('tv_head2', 'loading_dept_head')
        self.deputy = _make_user('tv_dep', 'loading_dept_head_deputy')
        self.boss = _make_user('tv_boss', 'boss')
        self.rule_a = TaskRule.objects.create(step='yuklenme', title_key='tasks.a',
                                              assignee_role='loading_dept_head')
        self.rule_b = TaskRule.objects.create(step='yuklenme', title_key='tasks.b',
                                              assignee_role='loading_dept_head')
        self.rule_open = TaskRule.objects.create(step='yuklenme', title_key='tasks.c',
                                                 assignee_role='loading_dept_head')
        TaskRuleAssignee.objects.create(rule=self.rule_a, user=self.head1)
        TaskRuleAssignee.objects.create(rule=self.rule_b, user=self.head2)
        self.task_a = _task(self.rule_a)
        self.task_b = _task(self.rule_b)
        self.task_open = _task(self.rule_open)
        self.task_norule = _task(None)

    def _ids(self, user, scope=None):
        client = APIClient()
        client.force_authenticate(user)
        params = {'page_size': 500}
        if scope:
            params['scope'] = scope
        resp = client.get(self.URL, params)
        self.assertEqual(resp.status_code, 200)
        return {t['id'] for t in resp.data['results']}

    def test_mine_shows_own_assigned_and_unassigned(self):
        ids = self._ids(self.head1)
        self.assertIn(self.task_a.pk, ids)
        self.assertIn(self.task_open.pk, ids)
        self.assertIn(self.task_norule.pk, ids)
        self.assertNotIn(self.task_b.pk, ids)

    def test_colleagues_shows_only_others_assigned(self):
        ids = self._ids(self.head1, 'colleagues')
        self.assertEqual(ids, {self.task_b.pk})

    def test_mine_and_colleagues_partition(self):
        mine = self._ids(self.head2)
        colleagues = self._ids(self.head2, 'colleagues')
        self.assertFalse(mine & colleagues)
        self.assertEqual(
            mine | colleagues,
            {self.task_a.pk, self.task_b.pk, self.task_open.pk, self.task_norule.pk},
        )

    def test_deputy_assigned_to_head_rule(self):
        TaskRuleAssignee.objects.create(rule=self.rule_a, user=self.deputy)
        self.assertIn(self.task_a.pk, self._ids(self.deputy))
        self.assertIn(self.task_b.pk, self._ids(self.deputy, 'colleagues'))

    def test_inactive_assignee_falls_back_to_role(self):
        self.head2.is_active = False
        self.head2.save()
        self.assertIn(self.task_b.pk, self._ids(self.head1))
        self.assertNotIn(self.task_b.pk, self._ids(self.head1, 'colleagues'))

    def test_role_changed_assignee_falls_back_to_role(self):
        self.head2.role = 'warehouse_chief'
        self.head2.save()
        self.assertIn(self.task_b.pk, self._ids(self.head1))
        self.assertNotIn(self.task_b.pk, self._ids(self.head1, 'colleagues'))

    def test_colleagues_never_other_roles(self):
        other_rule = TaskRule.objects.create(step='yuklenme', title_key='tasks.d',
                                             assignee_role='warehouse_chief')
        wh = _make_user('tv_wh', 'warehouse_chief')
        TaskRuleAssignee.objects.create(rule=other_rule, user=wh)
        other_task = _task(other_rule, role='warehouse_chief')
        self.assertNotIn(other_task.pk, self._ids(self.head1, 'colleagues'))

    def test_supervisor_unchanged_and_scope_ignored(self):
        all_ids = {self.task_a.pk, self.task_b.pk, self.task_open.pk, self.task_norule.pk}
        self.assertTrue(all_ids <= self._ids(self.boss))
        self.assertTrue(all_ids <= self._ids(self.boss, 'colleagues'))

    def test_colleague_can_complete_others_task(self):
        client = APIClient()
        client.force_authenticate(self.head1)
        resp = client.post(f'/api/v1/export/tasks/{self.task_b.pk}/complete/')
        self.assertIn(resp.status_code, (200, 204), resp.data)
        self.task_b.refresh_from_db()
        self.assertEqual(self.task_b.state, TaskState.DONE)
        self.assertEqual(self.task_b.completed_by_id, self.head1.pk)
```

Gate test (Review Focus 5) — add to the same class:

```python
    def test_colleagues_scope_keeps_gate_filter(self):
        loc1 = LoadingLocation.objects.create(name='Gate1')
        loc2 = LoadingLocation.objects.create(name='Gate2')
        g1 = _make_user('tv_g1', 'garawul')
        g1.loading_location = loc1
        g1.save()
        g2 = _make_user('tv_g2', 'garawul')
        rule = TaskRule.objects.create(step='yuklenme', title_key='tasks.gate_x',
                                       assignee_role='garawul')
        TaskRuleAssignee.objects.create(rule=rule, user=g2)
        here = _task(rule, role='garawul', scope_location=loc1)
        there = _task(rule, role='garawul', scope_location=loc2)
        ids = self._ids(g1, 'colleagues')
        self.assertIn(here.pk, ids)
        self.assertNotIn(there.pk, ids)
```

Before running: confirm the gate role code (`GATE_GUARD_ROLE` in `backend/apps/core/roles.py`) and `LoadingLocation` required fields; adjust `'garawul'` / `create(...)` kwargs to match. If `sync_gate_tasks` on read cancels hand-made tasks, mark them with whatever field it keys on, or drop this one test and note it in the report.

- [ ] **Step 2: Run, verify fail**

Run: `python manage.py test apps.export.tests_task_rule_assignees.MeTasksAssigneeVisibilityTests --verbosity=1`
Expected: `test_mine_shows_own_assigned_and_unassigned` fails (task_b visible), colleagues tests fail.

- [ ] **Step 3: Implement** — in `backend/apps/core/views_me.py`, regular-user branch. Replace:

```python
            qs = qs.filter(assignee_role__in=task_roles_for(role)).filter(
                Q(assignee_user__isnull=True) | Q(assignee_user=request.user)
            )
```
with:
```python
            qs = qs.filter(assignee_role__in=task_roles_for(role)).filter(
                Q(assignee_user__isnull=True) | Q(assignee_user=request.user)
            )
            # TaskRule assignees (spec 2026-10-05): a rule with named users is
            # theirs under "mine"; the rest of the role get it under
            # ?scope=colleagues and may still act on it (IsTaskActor is role-based).
            # Live lookup through Task.rule — editing the list re-routes open tasks.
            from django.db.models import Exists, OuterRef
            from apps.export.models import TaskRuleAssignee

            # Only VALID assignees count: a deactivated user or one moved to
            # another role must not hide the task from the whole role — if
            # every named user is gone, the rule falls back to "whole role".
            # The queryset is already limited to task_roles_for(role), so this
            # role filter is correct for every row.
            rule_assignees = TaskRuleAssignee.objects.filter(
                rule_id=OuterRef('rule_id'),
                user__is_active=True,
                user__role__in=task_roles_for(role),
            )
            rule_has_assignees = Exists(rule_assignees)
            i_am_assignee = Exists(rule_assignees.filter(user=request.user))
            if request.query_params.get('scope') == 'colleagues':
                qs = qs.filter(rule_has_assignees).exclude(i_am_assignee)
            else:
                qs = qs.filter(~rule_has_assignees | i_am_assignee)
```

Leave the garawul block that follows as is — it applies to both scopes. Update the view docstring's filter list with `?scope=colleagues — regular users only; role tasks assigned to other users`.

Note: `rule_id IS NULL` → `rule_has_assignees` is False → stays in "mine", never in colleagues. Correct for code-generated kinds.

- [ ] **Step 4: Run, verify pass + no regressions**

```
python manage.py test apps.export.tests_task_rule_assignees apps.export.tests_task_api apps.export.tests_gate_tasks apps.export.tests_load_tasks apps.export.tests_daily_plan_tasks --verbosity=1
```
Expected: all OK. (Pre-existing failures listed in memory "Backend Test Suite Failures" — compare against a run on unchanged code before blaming this change.)

- [ ] **Step 5: Docs** — `docs/obsidian/reference/task.md`: visibility rules (mine vs colleagues). `docs/obsidian/processes/comments-tasks.md` if it describes My tasks filtering.

- [ ] **Step 6: Commit (only after "commit")**

```bash
git status && git diff --cached
git add backend/apps/core/views_me.py backend/apps/export/tests_task_rule_assignees.py docs/obsidian/reference/task.md
git commit -m "feat(p3): my tasks honours rule assignees + colleagues scope"
```

---

### Task 3: TaskRulesPage — assignees column + editor

**Files:**
- Modify: `frontend/src/types/index.ts:2365` (`ITaskRule`)
- Modify: `frontend/src/hooks/useTaskRules.ts`
- Modify: `frontend/src/mock/taskRules.ts` (add `assignees: []` to each mock row)
- Modify: `frontend/src/pages/export/TaskRulesPage.tsx`
- Modify: `frontend/src/i18n/{ru,en,tk}.json` (`task_rules` block)
- Test: `frontend/src/pages/export/TaskRulesPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 endpoints.
- Produces: `ITaskRuleAssignee { id: number; full_name: string }`; `ITaskRule.assignees: ITaskRuleAssignee[]`; hooks `useTaskRuleCandidates(ruleId: number | null)` and `useSetTaskRuleAssignees()` (mutation `{ruleId: number, userIds: number[]}`).

- [ ] **Step 1: Types** — in `frontend/src/types/index.ts` before `ITaskRule`:

```ts
export interface ITaskRuleAssignee {
  id: number;
  full_name: string;
}
```
and inside `ITaskRule` add:
```ts
  /** Named users who own this rule's tasks; empty = the whole role. */
  assignees: ITaskRuleAssignee[];
```
Add `assignees: []` to every row in `frontend/src/mock/taskRules.ts` and to the `rule()` helper in `TaskRulesPage.test.tsx`.

- [ ] **Step 2: Hooks** — append to `frontend/src/hooks/useTaskRules.ts` (add `useMutation, useQueryClient` to the import):

```ts
export interface ITaskRuleCandidate {
  id: number;
  full_name: string;
  role: string;
}

/** Users who may be assigned to a rule. Only fetched while the editor is open. */
export function useTaskRuleCandidates(ruleId: number | null) {
  return useQuery({
    queryKey: ['task-rule-candidates', ruleId],
    enabled: ruleId != null,
    queryFn: async (): Promise<ITaskRuleCandidate[]> => {
      const { data } = await api.get<ITaskRuleCandidate[]>(
        `/export/task-rules/${ruleId}/assignee-candidates/`,
      );
      return data;
    },
  });
}

export function useSetTaskRuleAssignees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ruleId, userIds }: { ruleId: number; userIds: number[] }) => {
      const { data } = await api.put<ITaskRule>(
        `/export/task-rules/${ruleId}/assignees/`, { user_ids: userIds },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-rules'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}
```

- [ ] **Step 3: Write failing tests** — add to `TaskRulesPage.test.tsx`. Extend the `vi.mock('@/hooks/useTaskRules', ...)` to also export `useTaskRuleCandidates: vi.fn(() => ({ data: [], isLoading: false }))` and `useSetTaskRuleAssignees: vi.fn(() => ({ mutate: vi.fn(), isPending: false }))`, and add `vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }))` with a module-level `const authState = { user: { role: 'admin', is_superuser: false } as { role: string; is_superuser: boolean } | null };` (set `role: 'warehouse_chief'` in the read-only test).

```tsx
describe('TaskRulesPage assignees', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows "Whole role" when a rule has no assignees', () => {
    renderPage([rule({ assignees: [] })]);
    expect(screen.getByText('Whole role')).toBeInTheDocument();
  });

  it('lists named assignees', () => {
    renderPage([rule({ assignees: [{ id: 7, full_name: 'Ahmed' }] })]);
    expect(screen.getByText('Ahmed')).toBeInTheDocument();
  });

  it('shows the edit button to admin only', () => {
    authState.user = { role: 'admin', is_superuser: false };
    renderPage([rule()]);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  it('hides the edit button from other roles', () => {
    authState.user = { role: 'warehouse_chief', is_superuser: false };
    renderPage([rule()]);
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });
});
```

Run: `npx vitest run src/pages/export/TaskRulesPage.test.tsx` → new tests FAIL.

- [ ] **Step 4: Implement** — in `TaskRulesPage.tsx`:

Imports: add `Button, Modal` to the antd import; `import { useAuth } from '@/hooks/useAuth';`; `import { useSetTaskRuleAssignees, useTaskRuleCandidates } from '@/hooks/useTaskRules';`.

Add a small editor component above `TaskRulesPage`:

```tsx
const ASSIGNEE_EDITOR_ROLES: readonly string[] = ['admin', 'director'];

function AssigneeEditor({ rule, onClose }: { rule: ITaskRule; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: candidates = [], isLoading } = useTaskRuleCandidates(rule.id);
  const setAssignees = useSetTaskRuleAssignees();
  const [picked, setPicked] = useState<number[]>(rule.assignees.map((a) => a.id));
  return (
    <Modal
      open
      title={t('task_rules.assignees_edit_title', { task: t(rule.title_key, { defaultValue: rule.title_key }) })}
      onCancel={onClose}
      okText={t('common.save')}
      confirmLoading={setAssignees.isPending}
      onOk={() => setAssignees.mutate(
        { ruleId: rule.id, userIds: picked },
        { onSuccess: onClose },
      )}
    >
      <Text type="secondary">{t('task_rules.assignees_hint')}</Text>
      <Select<number[]>
        mode="multiple"
        allowClear
        loading={isLoading}
        value={picked}
        onChange={setPicked}
        placeholder={t('task_rules.assignees_whole_role')}
        style={{ width: '100%', marginTop: 12 }}
        optionFilterProp="label"
        options={candidates.map((c) => ({ value: c.id, label: c.full_name }))}
      />
    </Modal>
  );
}
```

Inside `TaskRulesPage`:
```tsx
  const { user } = useAuth();
  const canEditAssignees = !!user && (user.is_superuser || ASSIGNEE_EDITOR_ROLES.includes(user.role));
  const [editingRule, setEditingRule] = useState<ITaskRule | null>(null);
```

New column right after the `col_role` column:
```tsx
    {
      title: t('task_rules.col_assignees'),
      key: 'assignees',
      width: 200,
      render: (_: unknown, rule: ITaskRule) => (
        <Space direction="vertical" size={4}>
          {rule.assignees.length === 0
            ? <Text type="secondary">{t('task_rules.assignees_whole_role')}</Text>
            : (
              <Space size={4} wrap>
                {rule.assignees.map((a) => <Tag key={a.id} style={{ margin: 0 }}>{a.full_name}</Tag>)}
              </Space>
            )}
          {canEditAssignees && (
            <Button size="small" onClick={() => setEditingRule(rule)}>
              {t('task_rules.assignees_edit')}
            </Button>
          )}
        </Space>
      ),
    },
```

Render the editor at the end of the page JSX: `{editingRule && <AssigneeEditor rule={editingRule} onClose={() => setEditingRule(null)} />}`.

Update the component docstring: the page is read-only except the assignee list (live lookup, no reconcile needed).

Confirm `common.save` exists in the i18n files (`grep -n '"save"' frontend/src/i18n/en.json`); use the existing key name if different.

- [ ] **Step 5: i18n** — inside the `task_rules` block of each file:

ru.json:
```json
    "col_assignees": "Исполнители",
    "assignees_whole_role": "Вся роль",
    "assignees_edit": "Назначить",
    "assignees_edit_title": "Исполнители: {{task}}",
    "assignees_hint": "Выбранные сотрудники видят эту задачу в «Мои задачи». Остальные сотрудники роли видят её во вкладке «Задачи коллег» и могут выполнить её. Пусто — задачу видит вся роль."
```
en.json:
```json
    "col_assignees": "Assignees",
    "assignees_whole_role": "Whole role",
    "assignees_edit": "Assign",
    "assignees_edit_title": "Assignees: {{task}}",
    "assignees_hint": "Selected users see this task under My tasks. Everyone else in the role sees it under Colleagues' tasks and can still do it. Empty = the whole role."
```
tk.json:
```json
    "col_assignees": "Ýerine ýetirijiler",
    "assignees_whole_role": "Ähli wezipe",
    "assignees_edit": "Bellemek",
    "assignees_edit_title": "Ýerine ýetirijiler: {{task}}",
    "assignees_hint": "Saýlanan işgärler bu meseläni «Meniň meselelerim» bölüminde görýärler. Wezipäniň beýleki işgärleri ony «Kärdeşleriň meseleleri» bölüminde görýärler we ýerine ýetirip bilýärler. Boş — ähli wezipe görýär."
```

- [ ] **Step 6: Run tests + typecheck**

```
npx vitest run src/pages/export/TaskRulesPage.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: PASS, no TS errors.

- [ ] **Step 7: Docs** — `docs/obsidian/screens/task-rules.md`: new Assignees column + editor, who sees the button.

- [ ] **Step 8: Commit (only after "commit")**

```bash
git status && git diff --cached
git add frontend/src/types/index.ts frontend/src/hooks/useTaskRules.ts frontend/src/mock/taskRules.ts \
  frontend/src/pages/export/TaskRulesPage.tsx frontend/src/pages/export/TaskRulesPage.test.tsx \
  docs/obsidian/screens/task-rules.md
git commit -m "feat(frontend): assign users to task rules on the Task Rules page"
```
i18n JSONs carry another session's uncommitted edits (git status at session start). Stage only this task's hunks: `git add -p frontend/src/i18n/ru.json` etc., or via a private `GIT_INDEX_FILE` (memory "Shared Worktree Sessions").

---

### Task 4: SelfBoard — "Colleagues' tasks" tab

**Files:**
- Modify: `frontend/src/hooks/useMyTasks.ts`
- Modify: `frontend/src/pages/me/SelfBoard.tsx` (~L263-275 state, ~L438 filter row)
- Modify: `frontend/src/i18n/{ru,en,tk}.json` (`me.board` block)
- Test: `frontend/src/pages/me/SelfBoard.test.tsx`

**Interfaces:**
- Consumes: `GET /me/tasks/?scope=colleagues` (Task 2).
- Produces: `useMyTasks({ role?, scope?: 'mine' | 'colleagues', enabled? })`; default `'mine'` sends no param, so the AppLayout nav badge is unchanged.

- [ ] **Step 1: Write failing tests** — in `SelfBoard.test.tsx`, change the mock signature to `vi.fn((_opts?: { role?: string | null; scope?: string }) => ...)` and pass `opts` through. Add:

```tsx
function lastScope(): string | undefined {
  const { calls } = useMyTasksMock.mock;
  return calls[calls.length - 1]?.[0]?.scope;
}

describe('SelfBoard colleagues tab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { useMyTasksMock.mockClear(); });

  it('regular role opens on its own tasks', () => {
    renderAs('loading_dept_head');
    expect(lastScope()).toBe('mine');
    expect(screen.getByText("Colleagues' tasks")).toBeInTheDocument();
  });

  it('switching the tab requests colleagues scope', () => {
    renderAs('loading_dept_head');
    fireEvent.click(screen.getByText("Colleagues' tasks"));
    expect(lastScope()).toBe('colleagues');
  });

  it('supervisors get no colleagues tab', () => {
    renderAs('boss');
    expect(screen.queryByText("Colleagues' tasks")).toBeNull();
  });
});
```

Run: `npx vitest run src/pages/me/SelfBoard.test.tsx` → new tests FAIL.

- [ ] **Step 2: Hook** — `frontend/src/hooks/useMyTasks.ts`:

```ts
export type MyTasksScope = 'mine' | 'colleagues';

export function useMyTasks(
  options: { enabled?: boolean; role?: string | null; scope?: MyTasksScope } = {},
) {
  const { enabled, role = null, scope = 'mine' } = options;
```
Add `scope` to the `queryKey`: `['my-tasks', seasonId, role, scope]`, and in `queryFn` after the role line:
```ts
      // Colleagues' tasks: the role's tasks a TaskRule assigns to other users.
      if (scope === 'colleagues') params.set('scope', 'colleagues');
```

- [ ] **Step 3: SelfBoard** — add `Segmented` to the antd import. State next to `pickedRole`:

```tsx
  // Regular roles: "mine" vs "colleagues" (TaskRule assignees, spec 2026-10-05).
  // Supervisors already see every task, so they get no tab.
  const [scope, setScope] = useState<MyTasksScope>('mine');
```
Import `MyTasksScope` from `@/hooks/useMyTasks`. Change the hook call to:
```tsx
    useMyTasks({ role: roleFilter, scope: isSupervisor ? 'mine' : scope });
```
At the start of the filter row (before the `isSupervisor && <Select ...>`):
```tsx
        {!isSupervisor && (
          <Segmented<MyTasksScope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: t('me.board.scope_mine') },
              { value: 'colleagues', label: t('me.board.scope_colleagues') },
            ]}
          />
        )}
```
KPI strip stays as is (role-level, spec).

- [ ] **Step 4: i18n** — inside `me.board`:

ru: `"scope_mine": "Мои задачи", "scope_colleagues": "Задачи коллег"`
en: `"scope_mine": "My tasks", "scope_colleagues": "Colleagues' tasks"`
tk: `"scope_mine": "Meniň meselelerim", "scope_colleagues": "Kärdeşleriň meseleleri"`

- [ ] **Step 5: Run tests + typecheck**

```
npx vitest run src/pages/me/SelfBoard.test.tsx src/components/AppLayout.menuGroups.test.tsx
npx tsc --noEmit --ignoreDeprecations 5.0
```
Expected: PASS. Note: `getByText("My tasks")` may now match both page title and tab — if an older test breaks on that, scope its query to the title element rather than renaming the key.

- [ ] **Step 6: Docs** — `docs/obsidian/screens/` My tasks/SelfBoard note (find via `docs/obsidian/00-index.md`): colleagues tab.

- [ ] **Step 7: Commit (only after "commit")** — explicit paths: `frontend/src/hooks/useMyTasks.ts frontend/src/pages/me/SelfBoard.tsx frontend/src/pages/me/SelfBoard.test.tsx` + own i18n hunks + the obsidian note.
`git commit -m "feat(frontend): colleagues' tasks tab on My tasks"`

---

### Task 5: Changelog + test log

- [ ] **Step 1:** `BUILD_TEST_LOG.md` (newest on top): `- [ ] 2026-10-05 — Task rule assignees + "Задачи коллег" tab (admin assigns users per rule on Task Rules page) — NEEDS TEST`
- [ ] **Step 2:** `CHANGELOG.md` `[Unreleased]` → **Added**: "Task rule assignees: admin/director assign users per task rule; others in the role see those tasks under «Задачи коллег» (p3, frontend)". Written after the code commits.
- [ ] **Step 3 (only after "commit"):** `git commit -m "docs: changelog and test log for task rule assignees"` with those two paths (stage own hunks only — `BUILD_TEST_LOG.md` already has another session's edit).
- [ ] **Step 4:** Beta deploy note for the user: needs `migrate export` (0094). No seed, no celery change.
