# Pallet QR Label & Scan

A printed label on each pallet — QR code on top, the shipment's `export_code`
underneath. Scanning it abroad is meant to record the next transit step of the
shipment (border crossed, destination customs, arrived, …).

**Status:** label PDF shipped (backend). Scan page + scan-confirm endpoint — NOT built yet.

## Decisions (2026-09-27, with the user)

- **Login required to scan.** The QR only opens a page; role checks from
  `transition_to()` still apply. Anyone photographing a pallet cannot change status.
- **Scannable steps:** from `serhet_gechdi` onward — `serhet_gechdi`, `barysh_gumrugi`,
  `bardy` and the later ones. Steps before departure stay on the Sheet.
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

## Scan (planned)

The scan fills the **trigger timestamp** of the current step (e.g. `border_crossed_at`,
`customs_entry_at`, `arrived_at`) and lets `auto_advance_if_ready()` move the status —
it never calls `transition_to()` directly. Repeat scans of the other pallets are no-ops
once the field is filled. See [[shipment-lifecycle]] and [[../reference/task-rules]].
