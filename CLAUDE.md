# YGT Platform

Django + React platform replacing Excel-based greenhouse tomato export operations for YGT Holding. Current focus: P3 Export module.

## Critical rules (violations break production)

- **MSSQL**: No JSONField, no ArrayField, no DISTINCT ON, bulk_create batch_size=500
- **Status transitions**: ALWAYS through `transition_to()` — never direct `status_id` update
- **AD-1**: Denormalized timestamps on shipment written ONLY by `transition_to()`
- **AD-2**: `vehicle_status_note` is DEPRECATED — use `vehicle_condition` + Comments
- **Auth**: httpOnly cookie JWT. Never localStorage. Users on public networks in KZ/RU.
- **Dependencies**: `core ← greenhouse ← export ← contracts ← finance`. No reverse imports. No Django signals.
- **API names ≠ DB columns**: serializer maps `code` → `cargo_code`, `weight_net_kg` → `weight_net`
- **models/ packages**: MUST have `__init__.py` with re-exports or migrations silently break
- **Obsidian docs**: When adding/changing any feature, component, endpoint, or model — update the corresponding doc in `docs/obsidian/`. See `docs/obsidian/00-index.md` for the full vault structure.

## Agent conduct (applies to ALL agents)

- **Never commit or push without explicit instruction.** "Done", "ready", "finished" are NOT commit instructions. Wait for the word "commit".
- **One commit = one logical unit.** Multi-phase work = multiple commits. Never bundle phases or unrelated changes.
- **Co-author tag** must reflect the actual model in use (default: `Claude Opus 4.7`). Verify with `product-self-knowledge` skill if unsure — never guess.
- **Never invent rules or context.** Only cite rules that exist in this file, `docs/ADR.md`, `DECISIONS.md`, or current user messages. If you think a rule should exist but isn't documented — ASK.
- **Report scope honestly.** State which tests passed (unit / integration / which app). If only part of a task is done, say so explicitly: *"Phase 2a backend done. Frontend NOT started."*
- **Stay in your lane.** `backend-dev` does not touch frontend code unless the task says so (and vice versa). If a task crosses lanes, flag it before acting.
- **When uncertain — ask.** A clarifying question costs 30 seconds; reverting an unwanted action costs hours.
- **When you make a mistake** — acknowledge briefly, propose options, wait for the user to choose. Do not auto-fix.

## Agents — use for domain-specific work

| Agent | When to use | What it knows |
|-------|------------|--------------|
| `backend-dev` | Creating/modifying Django models, serializers, viewsets | DDL v5.1 schema, 13-step lifecycle, TRANSITIONS dict, role windows, architecture decisions |
| `frontend-dev` | Creating/modifying React pages, components, hooks | 20+ screens, routing, role-based field visibility, Kanban/Planning grid specs, mobile targets |
| `reviewer` | After implementing a feature — quality check | MSSQL violations, AD-1/AD-2/AD-3 compliance, DDL alignment, dependency direction, auth security |
| `excel-analyst` | Analyzing .xlsx files for data migration | Excel→DDL target mapping, cargo code validation, data quality rules, R15→Comments migration |

## Skills — loaded on demand for code patterns

| Skill | Trigger | What it provides |
|-------|---------|-----------------|
| `django-model` | Creating a Django model | Template matching DDL v5.1 with AD-1/AD-2 fields, MSSQL-safe field types |
| `react-page` | Building a React page | ProTable list, detail page, TanStack Query hooks, TypeScript types matching api-contract |
| `api-endpoint` | Creating a DRF endpoint | Serializer with DB→API field renaming, ViewSet with my_work filter, transition endpoint |
| `excel-import` | Writing a migration script | openpyxl template with dry-run, transaction, cargo code validation, batch_size=500 |

## Commands — slash commands for workflows

| Command | What it does |
|---------|-------------|
| `/feature <name>` | End-to-end: model → serializer → types → mock → page → review |
| `/model <name>` | Create Django model from DDL v5.1 with issue fixes |
| `/review <scope>` | Run project-specific code review via reviewer agent |
| `/analyze-excel <file>` | Analyze Excel file via excel-analyst agent |
| `/setup` | One-time project initialization (Docker + Django + React scaffold) |
| `/status` | Sprint progress check (models, endpoints, pages, tests) |

## Orchestration patterns

**Single feature**: `/feature shipment-list` — runs the full sequence, invokes skills as needed.

**Build + review**: Build with `backend-dev` or `frontend-dev` agent, then verify with `reviewer` agent. Separate context windows = reviewer isn't biased by the build.

**Plan then execute**: For complex features, first ask to plan ("think hard about how to implement the quota dashboard"), then `/clear`, then execute the plan in a fresh context.

**Parallel work**: Backend and frontend can be built independently when mock data exists. Build backend model + API first, then frontend with `USE_MOCK=true`, then connect.

## Module boundaries

```
core ← greenhouse ← export ← contracts ← finance
                           ← transport
```

`greenhouse/` owns block-level operations: BlockManagerAssignment, WeeklyHarvestPlan, DomesticSale.
`export/` owns shipment lifecycle, quotas, truck allocation, local sell plans, pricing.
P3 Export is the current focus. `core/`, `greenhouse/`, and `export/` are active.

## Where to find things

| Need | Location |
|------|----------|
| What changed recently | `CHANGELOG.md` (update after every feature/fix) |
| Architecture decisions (AD-1 through AD-13) | `docs/ADR.md` |
| Project decision log (running record) | `DECISIONS.md` |
| Database schema + decisions | `database/ygt_platform_ddl_v5_1.sql` |
| API field names + response shapes | `.claude/rules/api-contract.md` |
| Full domain context (roles, lifecycle, firms) | `docs/DOMAIN.md` |
| Sprint plan with screen list | `docs/SPRINT_PLAN.md` |
| MSSQL forbidden patterns | `.claude/rules/mssql-compat.md` |
| Backend architecture + Django gotchas | `.claude/rules/backend-arch.md` |
| Frontend architecture + state management | `.claude/rules/frontend-arch.md` |
