# YGT Platform

Django + React platform replacing Excel-based greenhouse tomato export operations for YGT Holding. Current focus: P3 Export module.

## Critical rules (violations break production)

- **MSSQL**: No JSONField, no ArrayField, no DISTINCT ON, bulk_create batch_size=500
- **Status transitions**: ALWAYS through `transition_to()` — never direct `status_id` update
- **AD-1**: Denormalized timestamps on shipment written ONLY by `transition_to()`
- **AD-2**: `vehicle_status_note` is DEPRECATED — use `vehicle_condition` + Comments
- **Auth**: httpOnly cookie JWT. Never localStorage. Users on public networks in KZ/RU.
- **Dependencies**: `core ← greenhouse ← export ← contracts ← finance`. No reverse imports. No Django signals.
- **API names ≠ DB columns**: serializer maps `code` → `shipment_code`, `weight_net_kg` → `weight_net`
- **models/ packages**: MUST have `__init__.py` with re-exports or migrations silently break
- **Obsidian docs**: When adding/changing any feature, component, endpoint, or model — update the corresponding doc in `docs/obsidian/`. See `docs/obsidian/00-index.md` for the full vault structure.
## Output style
Always follow the rules in the `i-have-adhd` skill: action-first, numbered steps, no preamble, no closers, state restated each turn.
##  Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.
## Agent conduct (applies to ALL agents)

- **Never commit or push without explicit instruction.** "Done", "ready", "finished" are NOT commit instructions. Wait for the word "commit".
- **One commit = one logical unit.** Multi-phase work = multiple commits. Never bundle phases or unrelated changes.
- **Co-author tag** must reflect the actual model in use (default: `Claude Opus 4.7`). Verify with `product-self-knowledge` skill if unsure — never guess.
- **Never invent rules or context.** Only cite rules that exist in this file, `docs/ADR.md`, `DECISIONS.md`, or current user messages. If you think a rule should exist but isn't documented — ASK.
- **Report scope honestly.** State which tests passed (unit / integration / which app). If only part of a task is done, say so explicitly: *"Phase 2a backend done. Frontend NOT started."*
- **Stay in your lane.** `backend-dev` does not touch frontend code unless the task says so (and vice versa). If a task crosses lanes, flag it before acting.
- **When uncertain — ask.** A clarifying question costs 30 seconds; reverting an unwanted action costs hours.
- **When you make a mistake** — acknowledge briefly, propose options, wait for the user to choose. Do not auto-fix.
- **Log every build that needs testing.** Whenever you build or meaningfully change a feature/fix, append an entry to `BUILD_TEST_LOG.md` (newest on top): `- [ ] YYYY-MM-DD — <what was built> — NEEDS TEST`. Then, in your reply, state plainly: *"Built — NOT tested yet. Did you test it?"* Check the item off (`- [x]`) only when the user confirms they tested it.

## Orchestration patterns

**Single feature**: `/feature shipment-list` — runs the full sequence, invokes skills as needed.

**Build + review**: Build with `backend-dev` or `frontend-dev` agent, then verify with `reviewer` agent. Separate context windows = reviewer isn't biased by the build.

**Plan then execute**: For complex features, first ask to plan ("think hard about how to implement the quota dashboard"), then `/clear`, then execute the plan in a fresh context.

**Parallel work**: Backend and frontend can be built independently when mock data exists. Build backend model + API first, then frontend with `USE_MOCK=true`, then connect.

## Module boundaries

P3 Export is the current focus. `core/`, `greenhouse/`, and `export/` are active.
Full dependency direction and per-app ownership: `backend/CLAUDE.md`.

## Where to find things

| Need | Location |
|------|----------|
| What changed recently | `CHANGELOG.md` (update after every feature/fix) |
| Architecture decisions (AD-1 through AD-13) | `docs/ADR.md` |
| Project decision log (running record) | `DECISIONS.md` |
| Database schema + decisions | `database/ygt_platform_ddl_v5_1.sql` |
| API field names + response shapes | `api-contract` skill (`.claude/skills/api-contract/SKILL.md`) |
| Full domain context (roles, lifecycle, firms) | `docs/DOMAIN.md` |
| Sprint plan with screen list | `docs/SPRINT_PLAN.md` |
| MSSQL forbidden patterns | `.claude/rules/mssql-compat.md` |
| Backend architecture, Django gotchas, Python style | `backend/CLAUDE.md` |
| Frontend architecture, state management, i18n, TS style | `frontend/CLAUDE.md` |
