# Pallet QR Label & Scan

A printed label on each pallet — QR code on top, the shipment's `export_code`
underneath. Scanning it abroad is meant to record the next transit step of the
shipment (border crossed, destination customs, arrived, …).

**Status:** label PDF + scan endpoint shipped (backend). Frontend `/scan/:id` page and the "Print label" button — NOT built yet.

## Decisions (2026-09-27, with the user)

- **Login required to scan.** The QR only opens a page; the user's per-field
  Sheet grant decides whether they may record the step. Anyone photographing a pallet cannot change status.
- **Scannable steps:** every step from departure (`yola_chykdy`) up to `satyldy`, including
  `dest_entry`. `satyldy → tamamlandy` is finance work and stays manual. Steps before departure
  stay on the Sheet.
- **Printer:** regular office printer, A5 max.
- **One label**, printed once per pallet (no per-pallet numbering).
- **Online only** — no offline scan queue.

## Label — `GET /api/v1/export/shipments/{id}/label/`

- A5 portrait PDF, one page: 120 mm QR (error-correction level Q) + `export_code` in
  large bold text, shrunk to fit long codes.
- QR encodes `{PLATFORM_URL or request origin}/scan/{shipment id}`. Production serves
  the SPA and `/api` from one origin, so the request origin is the frontend host;
  set `PLATFORM_URL` if it is not.
- `400 {error}` when the shipment has no `export_code` yet.
- Gate: normal `shipment.can_view` (GET on the shipment viewset).
- Builder: `backend/apps/export/exports/shipment_label.py` (reportlab, no extra dependency).
- Tests: `backend/apps/export/tests_shipment_label.py`.

## Scan — `GET | POST /api/v1/export/shipments/{id}/scan/`

The scan fills the **trigger timestamp** of the current step and lets
`Shipment.save()` → `auto_advance_if_ready()` move the status. It never calls
`transition_to()` directly. See [[shipment-lifecycle]] and [[../reference/task-rules]].

| Status now | Scan fills | Status goes to |
|---|---|---|
| yola_chykdy | `border_crossed_at` | serhet_gechdi |
| serhet_gechdi | `dest_entry_at` | dest_entry |
| dest_entry | `customs_entry_at` | barysh_gumrugi |
| barysh_gumrugi | `arrived_at` (or `peregruz_date` when `has_peregruz`) | bardy / transshipment |
| transshipment | `arrived_at` | bardy |
| bardy | `sale_started_at` | satylyar — only once `city` is also filled on the Sheet |
| satylyar | `sale_ended_at` | satyldy |

- **Which field:** read from the shipment's open auto-resolving Task for the current step
  (`services/scan.py::scan_target_field`), limited to the `SCAN_STEPS` / `SCAN_FIELDS`
  allowlists. So the peregruz fork and admin edits of task rules are honoured.
- **GET** → `{id, code, export_code, status, field}`; `field` is null when nothing is scannable.
- **POST** `{field, occurred_at?}` (default now) → same payload + `recorded: true`.
  - Field already filled → `200 recorded: false` (other pallets of the same truck; no-op).
  - Field not the current step's → `400`. Archived / deleted → `403`.
  - Write goes through `ShipmentPatchSerializer` — same per-field Sheet grant (AD-17) and
    `AuditLog` rows as a Sheet PATCH. No grant → `403`.
- **Permission:** POST drops `DynamicResourcePermission` (POST maps to `shipment.can_create`,
  which transport / sales_rep lack); the field grant decides. GET keeps `shipment.can_view`.
- Tests: `backend/apps/export/tests_shipment_scan.py`.
