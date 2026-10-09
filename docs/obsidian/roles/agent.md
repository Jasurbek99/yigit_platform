---
title: Agent
tags: [role, agent, market, external]
related: [[roles-matrix]], [[agent-seller]], [[../processes/agent-market]], [[../processes/permissions-system]]
---

# Agent

**Role code**: `agent` (external). **Added**: 2026-10-08 (agent market, part A).

## Who

A customer (bazaar sales partner) outside YGT. One login per agent, bound to a `core.Customer` through `market.AgentMember`. Our `sales_rep` or other staff create the login on `/market/agents` — never on the Users page.

## What He Does (Part A)

On his phone at `/m/` (own login `/m/login`, Russian by default, installable as a PWA) he runs his team on the «Команда» screen: adds **bazaars** and **seller logins** (each seller is bound to one active bazaar), changes a seller's password, switches a seller off or on. The home screen is a placeholder until Part B (lots, sales, spoilage, expenses).

## Access

- Pages: `market.home`, `market.team` — nothing else.
- Resource: `market_team` full CRUD (writes only for his own customer).
- **Fenced**: any API outside `/api/v1/auth/` and `/api/v1/market/` returns 403; the WebSocket closes with 4403. The main app redirects him to `/m/`.
- Only the agent manages the team — staff roles only read it.

## Not delegated

Agent logins are not manageable by `loading_dept_head` (`MANAGEABLE_BY_ROLE`); admin and staff holding the `market_agent` resource create them.

See [[../processes/agent-market]].
