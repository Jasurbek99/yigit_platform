# Pallet QR Label & Scan

A printed label on each pallet — QR code on top, the shipment's `export_code`
underneath. Scanning it abroad is meant to record the next transit step of the
shipment (border crossed, destination customs, arrived, …).

**Status:** shipped end to end — label PDF, the **Print label** button on the shipment
screen, the scan endpoint and the `/scan/:id` phone page.

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
- QR encodes `{base}/scan/{shipment id}`, where `base` is, most explicit first:
  **`GreenhouseConfig.scan_base_url`** (Shipment Settings → Pallet QR, migration `core/0065`),
  then `settings.PLATFORM_URL`, then the requesting origin. Production serves the SPA and
  `/api` from one origin, so the request origin is the frontend host — enough for a LAN
  install with nothing configured.
- **Set the base address before a print run.** The value is printed onto the label and
  travels with the truck; an already-printed label cannot be re-pointed when the host
  changes. That is why it is an admin setting and not only an env var. The settings tab
  previews the exact URL a fresh label would encode, and the serializer refuses a relative
  value or a bare host — a typo here is not a 500, it is a print run no phone can open.
- `400 {error}` when the shipment has no `export_code` yet.
- Gate: normal `shipment.can_view` (GET on the shipment viewset).
- Builder: `backend/apps/export/exports/shipment_label.py` (reportlab, no extra dependency).
- Tests: `backend/apps/export/tests_shipment_label.py`.

### Printing it

**Print label** sits in the shipment detail header, beside the pallet-manifest link. It is
shown only when the shipment has an `export_code` — that is what the label prints and what a
scanner reads back, and the endpoint 400s without one, so offering the button earlier would
be a dead download. No extra role gate: the label carries nothing beyond the code already on
that page, and the scan page behind the QR runs its own per-field check. Downloads through
`downloadFile()`, so a 400 surfaces as the server's own message instead of opening raw JSON
in a tab. One page per PDF — the operator prints as many copies as the truck has pallets.

## Duplicate scans

Every pallet of one truck carries the **same** QR target, so two operators scanning
together is the normal case, not an edge one. The POST locks the shipment row and re-reads
the trigger field under the lock before writing: a real step is hours long, so a second
scan inside that window is always a duplicate. It is refused and answered `200
{recorded: false, already: {field, occurred_at, recorded_by}}` — `recorded_by` comes from
the `AuditLog` row every write path already leaves, so it also names an operator who filled
the cell on the Sheet instead of scanning. The phone page shows that banner instead of a
button.

## Phone page — `/scan/:id`

Outside `AppLayout` on purpose: a driver in a yard gets the truck code, the current status
and one button. Behind `ProtectedRoute`, so an unauthenticated scan lands on
`/login?next=%2Fscan%2F{id}` and returns here after signing in — no second scan needed
(see [[authentication]], 2026-09-30).

**It never records on load.** Tapping the button opens a confirm dialog naming the step and
the truck; only "Yes" writes. A status step is a real-world event, and a mis-tap would
otherwise advance the truck silently. Field labels are reused from
`shipment_edit_drawer.field.*` so the same event is not named two different ways here and on
the Sheet.

- Page: `frontend/src/pages/scan/ScanPage.tsx`, hook `frontend/src/hooks/useShipmentScan.ts`.
- Tests: `frontend/src/pages/scan/ScanPage.test.tsx` (6 — including "records nothing on
  load", "cancelling writes nothing", and the already-recorded banner).

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
