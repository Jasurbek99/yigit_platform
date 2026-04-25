---
title: Assignment Board
tags: [process, frontend, shipment, draft]
related: [[draft-shipments]], [[shipment-lifecycle]], [[quota-management]]
---

# Assignment Board

## What Is This Process?

The screen where **Gadam (export_manager)** matches drafts from the pool to demand — open contracts, quota gaps, and waiting customers. Confirming a match transitions a draft into the 13-step lifecycle.

Reference: [[draft-shipments]] describes the two-phase creation. This note covers the assignment screen specifically.

## Layout

Three columns:

| Column | Source | Selection |
|--------|--------|-----------|
| **Supply** (left, 320px) | `useDrafts()` — unassigned drafts sorted oldest-first | Click selects one draft |
| **Match panel** (centre, flex) | Derived from both selections | Shows compatibility + confirm button |
| **Demand** (right, 340px) | Contracts / quota gaps / waiting customers, grouped | Click selects one demand item |

The match panel only activates once both a draft and a demand are selected.

## Compatibility Rules

- Demand item has `pref` (preferred variety) and `strict` (boolean).
- **`strict: false` or `pref: "Islendik"`** — green ✓ match.
- **`strict: true`** — amber ⚠ "variety confirmed at packaging" warning. Gadam may still confirm, but the pallet manifest later must match.
- **Draft is `age: 'old'` (2+ days)** — red ✗ "export unfit, use domestic" warning (operational rule: tomato older than 1 day is not export-grade).
- **Draft is `age: 'yest'`** — amber "urgent — dispatch today or redirect to Gapy Satyş".

## Confirm Flow

1. Gadam clicks **Tassykla / Confirm** in the match panel.
2. Frontend calls `useAssignDraft({id, country, customer, firm, city})` → `POST /api/v1/export/shipments/{id}/assign/`.
3. Backend runs `transition_to(shipment, 'yuklenme', request.user, comment='assigned from draft')`:
   - Role check: only `export_manager` or `PRIVILEGED_ROLES`.
   - AD-1: writes `loading_started_at = timezone.now()`.
   - Appends `ShipmentStatusLog`.
4. Frontend receives detail, `Modal.confirm()` prompts navigation to `/shipments/:id`.

## Demand Data Sources

**MVP status**: demand column uses `MOCK_DEMAND` with three groups (`Açyk şertnamalar`, `Kwota boşlyklary`, `Garaşýan / ýerli`). Annotated with `// TODO: wire to real endpoints`.

Future wiring:
| Group | Source | Hook |
|-------|--------|------|
| Open contracts | Contract remaining-kg aggregation | `useOpenContracts()` (TBD) |
| Quota gaps | `QuotaIssuance` remaining per firm/country | `useQuotaGaps()` (TBD) |
| Waiting customers | Customer `priority_queue` flag | `useWaitingCustomers()` (TBD) |

## Files

- Page: `frontend/src/pages/export/AssignmentBoard.tsx`
- Route: `/export/assign` (`pageCode: 'export.assign'`)
- Navigation: "Belgilemek" in the export group of the sidebar
- Backend endpoint: `POST /api/v1/export/shipments/{id}/assign/` — `ShipmentViewSet.assign()` in `backend/apps/export/views.py`

## Permissions

- **Read**: `export.assign` page — export_manager, director.
- **Mutation**: resource `shipment_assign` — export_manager, director.
- Warehouse_chief (Soltanmyrat) does **not** see this page; they create drafts in the Draft Pool only.

## Related

- [[draft-shipments]] — full draft lifecycle and backend detail.
- [[shipment-lifecycle]] — post-assignment 13 steps.
- [[quota-management]] — source of quota gap data.
- [[decisions-log]] — ADR-014 captures why this is a separate screen.
