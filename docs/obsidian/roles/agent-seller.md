---
title: Agent Seller
tags: [role, agent_seller, market, external]
related: [[roles-matrix]], [[agent]], [[../processes/agent-market]], [[../processes/permissions-system]]
---

# Agent Seller

**Role code**: `agent_seller` (external). **Added**: 2026-10-08 (agent market, part A).

## Who

A seller working at one bazaar for an agent. The login is created by the agent on «Команда» and bound to the agent's customer and to one active `Bazaar` via `market.AgentMember`.

## What He Does (Part A)

Logs in at `/m/login`, lands on `/m/` and sees the placeholder home («Машин пока нет»). Selling, spoilage and expenses arrive in Part B.

## Access

- Page: `market.home` only. No «Команда» tab; `/m/team` redirects him to the home screen.
- Resource: an explicit all-denied `market_team` row (keeps the admin permission matrix saving — it rejects a matrix missing a role).
- Same fence as [[agent]]: only `/api/v1/auth/` and `/api/v1/market/` reach him; the WebSocket closes with 4403.
- `GET /api/v1/market/me/` returns his role, customer and bazaar.

See [[../processes/agent-market]].
