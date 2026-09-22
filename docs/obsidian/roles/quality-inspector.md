---
title: Quality Inspector
tags: [role, quality, transport]
related: [[roles-matrix]], [[transport]], [[permissions-system]], [[shipment-lifecycle]], [[task-rules]]
---

# Quality Inspector

## Who

**People**: Hil Gözegçi
**Role code**: `quality_inspector`
**Added**: 2026-09-22

## What They Do

The quality inspector signs off on the cargo's condition: the four quality
certificates that must physically travel with the truck, and the transit
readings that determine whether the tomatoes arrive saleable — days in transit,
transport temperature, and remaining shelf life.

> [!note] Split out of `transport`
> Before 2026-09-22 this work was seeded onto the `transport` role, with the
> comment *"R27 transit days + temp (quality inspector)"* sitting in
> `seed_permissions.py` — the role it named did not exist yet. Creating it moved
> `transit_days`, `transport_temp_c` and `shelf_life_days` off `transport`, so
> Malik and Haltac no longer edit those cells. See [[transport]].

## Active Lifecycle Steps

None. The inspector triggers no status transition — `transition_to()` is
untouched by this role. They edit fields on shipments other roles move through
the lifecycle.

## Resources

| Resource | Access |
|----------|--------|
| `quality_document` | view + create + edit (all four fields) |
| `shipment` | view + edit (three fields only) |
| `shipment_comment` | view + create + edit |

### Editable shipment fields

`transit_days`, `transport_temp_c`, `shelf_life_days` — and nothing else.

### Quality certificates

Four documents, each **uploaded as a file** (JPG or PDF, max 10 MB, up to 5 per
certificate for multi-page scans and re-issues):
`azyk_maglumatnama`, `suriji_gozukdiriji`, `hil_sertifikaty`, `kalibrowka_analiz`.

Until 2026-09-22 these were four operator-ticked checkboxes. They are now
**derived**: the boolean on `QualityDocument` is true iff at least one
`QualityCertificate` scan of that type exists, so a tick cannot claim a
certificate that is not there. `services/quality.py::sync_certificate_flags` is
their only writer — the same one-writer discipline AD-1 applies to the lifecycle
timestamps. The boolean write endpoint (`PATCH /shipments/{id}/quality/`) was
removed.

The booleans stay real columns on purpose: `boss_analytics` and
`dashboard_summary` filter on them, and ShipmentList's four columns and the
Sheet's document icons read them. Nothing downstream changed.

| Endpoint | Gate |
|----------|------|
| `GET  /export/shipments/{id}/quality-certificates/` | shipment `can_view` |
| `POST /export/shipments/{id}/quality-certificates/` | `quality_document.can_edit` |
| `POST .../quality-certificates/{cert_id}/delete/` | `quality_document.can_edit` |
| `GET  .../quality-certificates/{cert_id}/download/` | shipment `can_view` |

Removal is a **POST**, not a DELETE: `ShipmentViewSet` sets
`http_method_names` without `delete` so a shipment cannot be destroyed through
the API, and re-adding it for a sub-resource would re-expose `destroy` on the
parent. Same shape as its existing `hard-delete` / `soft-delete` actions.

Files stream through the authenticated download action only — never a
`/media/` URL, which nginx serves unauthenticated on this deployment.

## Pages They See

Dashboard, Shipment List, Sheet, Shipment Dashboard, Kanban Board, plus the
universal set (My Tasks, Feedback, Work Hours, Team Leaderboard). 11 visible of
49 registered. Deliberately **not** the Daily Harvest Board — the inspector
works the truck, not the greenhouse plan.

## Sheet

Row 26, `transit_days_temp` — a virtual cell rendered as `"${days}d ${temp}°C"`
that parses two numbers from one text input and PATCHes both real fields in one
request. `can_edit_sheet_field` delegates the virtual key's permission check to
the real `transit_days` field, so the `transit_days` grant is what opens the
cell. Migration `export/0074` moved the row's `SheetRowRoleTrigger` and its
`role_group` from `transport` to `quality_inspector`.

## User Management

Admin only (AD-15). The role is absent from `MANAGEABLE_BY_ROLE`, so no
department head may create quality-inspector accounts.

## Tasks

One rule, `tasks.quality_inspection` on step `yuklenme` ("Hil barlagy" /
"Проверка качества"). It appears on My Tasks when the loading department fills
Sheet R19 "Ýükleme başlady" (`loading_started_at`) — that resolves the
`gumruk_chykysh` task and auto-advances the shipment into `yuklenme`.

The task lists all seven fields the inspector owns. `MANUAL_DONE`: the inspector
closes it themselves, and it can never hold a truck at `yuklenme`. See
[[task-rules]] for why that matters — the 2026-06 version of this rule gated
departures and had to be disabled.

## Key Workflows

1. **Take the task**: My Tasks → "Hil barlagy" → fill transit days / temperature
   / shelf life inline on the card
2. **Upload certificates**: ShipmentDetail → quality certificates → one upload
   slot per document (the `quality.*` rows on the task card stay read-only —
   dotted paths — so the scans are attached here, not on the card)
3. **Record transit readings**: or on the Sheet → row 26 → type `"5 4"` → days=5, temp=4°C
4. **Close the task**: Mark Done once the cargo is inspected
5. **Flag a problem**: add a shipment comment (AD-2 — no free-text status notes)

## Test Login

`t_quality_inspector` / `Test1234!` (see [`TEST_ACCOUNTS.md`](../../TEST_ACCOUNTS.md))
