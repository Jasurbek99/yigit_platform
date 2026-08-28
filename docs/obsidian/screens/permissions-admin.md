---
title: Permissions Admin
tags: [screen, admin, permissions, p3]
related: [[../reference/packing-template-model]], [[shipment-sheet]]
---

# Permissions Admin

The single role-first permission editor at `/admin/permissions`.
Component: `frontend/src/pages/admin/PermissionsPage.tsx`.

## Access

PageCode `admin.permissions` — admin only (AD-15). Every endpoint behind this
screen is additionally gated by `_AdminOnlyPermission` server-side, which
restricts **GET as well as writes**.

## Layout (rewritten 2026-08-27)

Pick a role on the left; the right pane shows everything that role may do, in
three collapsible sections. One Save button covers all three.

It previously had three tabs, each rendering its own `item × 15-role` matrix
with its own Save button. That layout answered "who can see the quota page"
while the admin's actual question is "what can Sulgun do", and cost a 15-column
horizontal scroll to do it.

| Piece | File |
|---|---|
| Page shell, role picker, search, Save | `PermissionsPage.tsx`, `permissions/RoleSidebar.tsx` |
| Section wiring (Collapse) | `permissions/RolePermissionEditor.tsx` |
| Sections | `permissions/sections/{Pages,Resources,Fields}Section.tsx` |
| Drafts + save orchestration | `permissions/useRolePermissionDrafts.ts` |
| Pure grouping / diff logic (tested) | `permissions/rolePermissionModel.ts` |
| The ⚠ list | `permissions/deadResources.ts` |

## Data flow

**No backend change was made for the rewrite.** The same three endpoints back it:

| Section | GET | PUT |
|---|---|---|
| Pages | `/core/admin/page-permissions/` | full matrix (backend validates every role is present) |
| Resources | `/core/admin/resource-permissions/` | full matrix |
| Fields | `/core/admin/field-permissions/` (no `?resource` → all of them) | **one resource per request** |

Save fires **only the endpoints whose section changed**. For fields that means
one PUT per touched resource — re-sending an untouched resource would clobber a
concurrent edit by another admin. `changedFieldResources()` computes that list
and is unit-tested.

On a failed save the drafts are deliberately **kept**, so the admin can retry
without re-ticking everything.

## The ⚠ markers — resources the matrix does not enforce

Audited 2026-08-27. Eight of the registry's resources have rows in the matrix
that save fine and change nothing, because the real decision is a hardcoded role
list in the view. The row is dimmed and carries a ⚠ naming what actually decides.

| Resource | Really decided by |
|---|---|
| `pallet` | `PALLET_WRITE_ROLES` — `export/views.py:100` + in-body checks (3012 / 3064 / 3164) |
| `manifest_close` | same `is_pallet_write` branch |
| `sales_report` | `PRIVILEGED_ROLES \| {'sales_rep'}` inside `set_sales_report()` |
| `quality_document` | `PRIVILEGED_ROLES \| {'document_team'}` — `export/views.py:2627` |
| `shipment_assign` | export_manager / director / boss, inside `assign()` |
| `domestic_sale` | `write_permission(*_DOMESTIC_WRITE_ROLES)` — `greenhouse/views.py:520` |
| `weekly_plan` | `HARVEST_DAY_WRITE`, in-body in `HarvestForecastView` |
| `greenhouse_block` | nobody — `ReadOnlyModelViewSet` + `IsAuthenticated`, writes are not exposed |

For `pallet` / `manifest_close` / `sales_report` this was **deliberate**: the
class-level `DynamicResourcePermission` gates on `shipment`, not on the junction's
own resource, so it wrongly 403'd the roles that own the manifest. The fix is a
gate pinned to the resource's own `resource_code` — the shape used for
`packing_template` (see [[../reference/packing-template-model]]) and for
`junction_write_permission`. Not yet applied to these eight.

`deadResources.ts` is a **hand-maintained list**, deliberately: deriving it needs
runtime introspection of the DRF router, which is a separate piece of work. When
a resource is moved onto the matrix, delete its entry — the test in
`rolePermissionModel.test.ts` pins the current set, so it fails loudly if the
list and the code drift.

## Sub-views of Shipments are three separate checkboxes

`/export/shipments`, `/export/shipments/sheet` and `/export/shipments/dashboard` used to
share the single `export.shipments` code, so the list, the Sheet and the Shipment Dashboard
could only be granted or hidden together. Since 2026-08-28 they are `export.shipments`,
`export.shipments_sheet` and `export.shipments_dashboard` (core migration `0036`, which
copied each role's existing `export.shipments` value into both new codes so nobody's access
changed on deploy).

The two new codes are **flat, not nested under `export.shipments.`** on purpose: `canSeePage`
grants a parent page whenever any `parent.`-prefixed child is visible, so a nested code would
have re-opened the Shipments list for anyone granted only the Sheet. `groupPages` splits on
the first dot, so both still render inside the `export` group. `export.shipments.board`
(Kanban) keeps the nested form and its latent version of that quirk.

## Known limitation — page visibility is not enforced server-side

`get_page_permissions()` is read by `/auth/me/` and nowhere else. **No endpoint
checks `page_code`.** Unticking a page removes it from the sidebar and makes
`ProtectedRoute` refuse the route — but the API behind that page still answers a
direct request. Treat the Pages section as menu configuration, not as an access
boundary; the resource section is the real gate.

## Related screen — `/admin/staff-access`

`StaffPageAccessPage.tsx` writes the **same `RolePagePermission` table**, scoped
to the roles a department head may manage (`MANAGEABLE_BY_ROLE`, ADR-022) and to
pages that head can already see. Its PUT is a surgical upsert, so it never
touches rows outside that set. Folding it into this screen as a restricted mode
is planned but not done.
