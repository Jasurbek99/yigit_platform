---
title: Agent Market (Part A — foundation)
tags: [process, backend, frontend, market, agent, pwa]
related: [[../roles/agent]], [[../roles/agent-seller]], [[permissions-system]], [[authentication]]
---

# Agent Market (Part A — foundation)

Bazaar sales for outside agents (customers) and their sellers. Spec: `docs/superpowers/specs/2026-10-08-agent-market-sales-design.md`. Plan: `docs/superpowers/plans/2026-10-08-agent-market-a-foundation.md`. Branch `feat/agent-market`.

## What Part A does

- Two external roles, `agent` and `agent_seller` (see [[../roles/agent]], [[../roles/agent-seller]]).
- A **fence**: external roles reach only `/api/v1/auth/` and `/api/v1/market/` (below).
- Our staff create **agent logins** on the desktop page `/market/agents`.
- A separate phone app at `/m/` (second Vite entry `m.html`, `src/market-app/`): own login `/m/login`, Russian by default, no antd, installable as a PWA. Screens: home (placeholder «Машин пока нет») and «Команда» (agent only: bazaars + seller logins).

**Not built yet (Parts B–E):** lots, sales, spoilage, expenses, QR claim, debts/payments, panels/analytics/Excel, SalesReport build.

## The fence

External roles (`EXTERNAL_ROLES = {agent, agent_seller}` in `apps/core/models/user.py`) are cut off from the rest of the platform in two places:

1. **REST** — `CookieJWTAuthentication.authenticate` (`apps/core/authentication.py`) raises 403 when the user's role is external and `request.path` does not start with `/api/v1/auth/` or `/api/v1/market/` (`EXTERNAL_ALLOWED_PREFIXES`). Fail-closed on the path.
2. **WebSocket** — `AppConsumer.connect` (`apps/core/consumers.py`) closes with code **4403** for external roles before `accept()` (4401 stays "not authenticated"). A future consumer must repeat the check.

Frontend mirror (UX only): `ExternalRoleGate` wraps the main app and sends external roles to `/m/`; the main `LoginPage` does the same after login (before any `?next=`). The market login sends non-external users to `/`.

## Pages, resources, grants

New page codes: `market.home`, `market.team` (phone shell), `market.agents` (desktop, staff). New resources: `market_agent` (agent logins), `market_team` (bazaars + seller logins). Seeded by `seed_permissions` and data migration `core/0076_seed_agent_market_perms`.

| Role | Pages | Resources |
|------|-------|-----------|
| `agent` | `market.home`, `market.team` (nothing else, not even the universal pages) | `market_team` VCRUD |
| `agent_seller` | `market.home` | `market_team` all-denied row |
| `sales_rep` | + `market.agents` | `market_agent` view / create / edit |
| `admin` | every page (incl. `market.home` / `market.team`) | full CRUD on both |
| `boss`, `director`, `export_manager`, `document_team` | `market.agents` (phone pages subtracted) | boss: full CRUD; others: view |
| everyone else | none | none |

Why `agent_seller` has an explicit all-denied `market_team` row: the admin matrix GET builds from existing rows and PUT rejects a matrix missing any role, so a role with zero resource rows would break `/admin/permissions` Save for everyone.

External roles are also kept out of the Fleet Map and Tır Takip every-role loops. See [[permissions-system#External roles and the fence (agent market, 2026-10)]].

## Data

App `market` (migration `market/0001_initial`, depends on `core/0076`):

- `Bazaar` — `customer` FK (PROTECT), `name` (unique per customer, Cyrillic collation), `city` FK (nullable), `is_active`. Table `market_bazaars`.
- `AgentMember` — `user` 1:1, `customer` FK (PROTECT), `bazaar` FK (nullable, sellers only). Table `market_agent_members`.
- `apps/market/scoping.py`: `customer_ids_for(user)` — agent / seller: own customer; `sales_rep`: customers where he is the rep; admin / boss / director / export_manager / document_team / superuser: `None` (all); others: none. `member_of(user)`.

## Endpoints (`/api/v1/market/`)

Shapes are in the `api-contract` skill.

- `GET|POST|PATCH /agents/` — agent logins (staff; scoped by `customer_ids_for`; resource `market_agent`).
- `GET|POST|PATCH /team/bazaars/`, `/team/sellers/` — resource `market_team`. Reads scoped; **writes only by the agent himself** (staff get 403 on write).
- `GET /me/` — role, customer, bazaar of the caller.

## Rules and gotchas

- **Agent logins are created only via `/market/agents/`** (the desktop page), not on the Users page — only that path creates the `AgentMember` row. An agent login with no `AgentMember` sees nothing.
- `core` cannot import `market`, so `seed_test_users` cannot make agent test logins; add a `market` management command in Part B if needed.
- **Branch migrations (core 0075 / 0076, export 0099, market 0001) are NOT applied to the shared DB until the branch is merged.** Beta runs old code on the same DB.
- After merge **and** after the beta deploy, re-run the permission seed (`seed_permissions` only creates missing rows).
- Every reference list an agent's phone needs (expense categories, cities, product types) must be served under `/api/v1/market/` from Part B on — they are behind the fence today.

## Deploy

- The market app is a **second Vite entry served at `/m/`**: rebuild the **frontend image** (nginx `location /m/ { try_files $uri /m.html; }`, plus no-cache exact locations for `/m/sw.js` and `/m/manifest.webmanifest`).
- `migrate core export market`.
- **PWA install needs HTTPS** (beta `https://export.yigithj.com`). `public/m/manifest.webmanifest`, no-cache `sw.js` (registered in prod builds only, caches nothing), PNG icons (192, 512, maskable 512, apple-touch 180).

## Connections

[[permissions-system]], [[authentication]], [[../roles/sales-rep]] (creates agent logins).
