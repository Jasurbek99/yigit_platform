# Supply Draft Creation (Phase C) — Design

**Date:** 2026-08-14
**Branch:** `main`
**Feature:** Bring the Sheet's two-phase supply/destination + join flow into the shipment (List/Detail) views. This spec covers **Phase C only** — a "Create supply draft" modal outside the Sheet.

Spec is in Russian-friendly plain terms where it helps the product owner review; code names are exact.

---

## 1. Scope

### The larger feature (4 pieces, phased)
Today the two-row join flow lives only in the Sheet: `loading_dept_head` (Soltanmyrat) makes a **supply** column (blocks/weights), `export_manager` (Gadam) makes a **destination** column (country/customer), and a **Join** merges supply→destination and hard-deletes the source. The product owner wants this available outside the Sheet, in the normal shipment views. Broken into:

- **A** — Join on the **Detail** page (pick a supply draft to merge into a destination draft)
- **B** — Join on the **List** page (select two drafts → Join)
- **C** — **"Create supply draft" modal** (this spec)
- **D** — Block-weight editor on the **Detail** page ("real loaded block source")

The backend `POST /export/shipments/{target}/join/` endpoint already exists and is fully tested (`tests_shipment_join.py`, 824 lines). A/B are frontend-only over that endpoint; C and D are this and a later spec.

**Build order (product owner's choice):** C first, then A/B, then D.

### This spec: Phase C
A modal, launched from the Shipment **List**, that lets `loading_dept_head` (and deputies / `warehouse_chief` / privileged roles) create a **supply draft** — a `status='draft'` shipment carrying a declared total weight, a set of greenhouse blocks (no per-block weights yet), variety, harvest status, notes and export code. Destination (country/customer) stays empty; that half is created separately by `export_manager` and merged in later via Join.

---

## 2. Decisions (all made by the product owner during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| 1 | Blocks are stored **without weights** at creation → make `ShipmentBlockSource.weight_kg` nullable | Soltanmyrat records a total up front; per-block weights come later. Chosen over even-split placeholders because null is an honest "not weighed yet" rather than a misleading equal split. |
| 2 | The declared **total weight** goes in `weight_net` | Same field the Sheet already treats as the truck total; per-block weights recompute it later (as the join already does). |
| 3 | **Variety** IS collected at creation | Overrides `draft-shipments.md:33` / Finding #3 ("variety not captured at draft creation"). Product owner: the rule is stale — Soltanmyrat knows the variety now. Doc will be updated. |
| 4 | Modal also collects **harvest status**, **notes**, **export code** | Operator has this at the morning supply moment. |
| 5 | Blocks are a **multi-select of any block** (not the forecast pool) | This is actual loaded supply, not a forecast draw. `skip_forecast_check` path (no 18,500 kg cap). |

### Phase-order consequence (resolved)
Because blocks are created immediately (with null weights), `source.block_sources.exists()` is **true** right after Phase C. So a supply draft created by this modal **can be joined immediately** — Phase D (exact per-block weights) is an enhancement, not a prerequisite. C + A/B already form a working cycle.

---

## 3. Data model change

### `ShipmentBlockSource.weight_kg` → nullable
`backend/apps/export/models/shipment.py:416` currently:
```python
weight_kg = models.DecimalField(max_digits=10, decimal_places=2)
```
becomes:
```python
weight_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```
A migration is required. MSSQL: this is a nullability change on an existing column — no data migration needed (existing rows keep their values).

### Consumer audit (mandatory — every reader of the block-weight sum)
Making `weight_kg` nullable means every place that sums or reads it must handle null. The implementation plan MUST enumerate these by grepping `block_sources__weight_kg`, `weight_kg`, and `Sum(` across `backend/apps/`, but the known ones are:

1. **Join `_execute_join`** (`backend/apps/export/views.py`, ~step 9): recomputes `target.weight_net = Sum(block_sources.weight_kg)`. With null weights this would null/zero the declared total. **Required behavior:** if any moved block has a null weight, do **not** overwrite the target's `weight_net` from the sum — keep the declared `weight_net` (Coalesce the sum, or skip the recompute when any weight is null). Add a join test for "join a supply with null block weights preserves weight_net."
2. **Weekly-plan actuals rollup** (per project memory: `actual_value` rolls up from `block_sources`): must treat null as excluded/0, not crash.
3. **Sales-report block breakdown** (`compute_block_variety_breakdown`): reads from **pallets**, not `block_sources.weight_kg` — likely unaffected, but confirm.
4. **Sheet even-split write path** (R8, `SheetCellEditor.tsx:567` → backend): still writes explicit weights; unaffected on write, but any read of the block sum for display must handle null.
5. Any DRF serializer exposing a per-block weight or a block-sum annotation.

Each consumer gets a one-line decision (Coalesce-to-0 vs exclude vs preserve-declared) recorded in the plan, and a test where it matters.

---

## 4. Backend — extend draft creation

**Endpoint (unchanged route):** `POST /api/v1/export/shipments/` with `is_draft: true`.

**New accepted payload shape for a supply draft:**
```json
{
  "is_draft": true,
  "skip_forecast_check": true,
  "weight_net": "22000.00",
  "block_ids": [3, 7, 12],
  "variety": 5,
  "harvest_status": "harvested",
  "export_code": "10AP116/26",
  "notes": "..."
}
```

- `_create_draft_shipment` (`backend/apps/export/views.py:1843`+) already creates a bare draft and can take `block_sources`. Extend it to accept **blocks without weights** — a `block_ids` list creating `ShipmentBlockSource(shipment, block_id, weight_kg=None)` rows via `bulk_create(batch_size=500)`.
- Persist `weight_net`, `variety` (+ `varieties_dominant` first-variety back-compat as the existing multi-variety draft path does), `harvest_status`, `export_code`, `notes`.
- Reuse the existing `skip_forecast_check=True` path (supply drafts skip the 18,500 kg cap — see `SupplyDraftWeightCapTests`).
- **Permission:** the existing draft-create role gate (`PRIVILEGED_ROLES | {warehouse_chief, loading_dept_head, loading_dept_head_deputy}`, `views.py:1770`) already covers who may create supply drafts — reuse it, do not widen it.
- Keep `block_ids` as a distinct input from the weighted `block_sources` the forecast composer sends, so the two create paths stay legible.

The serializer (`ShipmentCreateSerializer` or the draft branch) validates: `weight_net` optional decimal ≥ 0; `block_ids` optional list of existing block ids (deduped); `variety`/`harvest_status` optional and valid.

---

## 5. Frontend — the modal

**New component:** `frontend/src/components/shipment/SupplyDraftModal.tsx` (≤150 lines; extract a row sub-component if needed).

**Launch:** a "Create supply draft" button in the Shipment **List** toolbar (`frontend/src/pages/export/ShipmentList.tsx`), shown only to roles that may create supply drafts (`loading_dept_head`, deputies, `warehouse_chief`, privileged) — mirror the backend gate via the existing role helpers, do not hardcode a second list.

**Fields:**
| Field | Control | Required | Maps to |
|---|---|---|---|
| Total weight (kg) | number input | yes | `weight_net` |
| Blocks | `BlockSelect` multiple (all active blocks, `excludeIds` dedupe) | ≥1 | `block_ids` → block_sources, weight null |
| Variety | `VarietySelect` | no | `variety` |
| Harvest status | option select (`harvestStatus`) | no | `harvest_status` |
| Export code | `OfficialCodeEditor` (reuse) | no | `export_code` |
| Notes | textarea | no | `notes` |

- Submit via a new `useCreateSupplyDraft()` hook (or extend `useCreateDraft`) → the endpoint above, with an idempotency key (reuse `useIdempotencyKey`, as `ShipmentCreateModal` does).
- On success: toast, refetch the list, close. Do **not** auto-navigate (product owner can open the new draft from the list).
- i18n: all labels/toasts in `tk.json` / `ru.json` / `en.json` (strict). New namespace `supply_draft.*`.

**Not in this modal:** country/customer/city/import_firm (that's the destination half), per-block weights (Phase D), firm_splits.

---

## 6. Docs to update

- `docs/obsidian/processes/draft-shipments.md:33` — Finding #3 note ("variety not captured at draft creation") is now stale for the supply-modal path; add a line that the Create-supply modal captures variety at creation (product-owner decision, 2026-08-14).
- Add a short "Create supply draft (outside Sheet)" subsection to `draft-shipments.md` describing the modal, the nullable `weight_kg`, and that such drafts are joinable immediately.
- `CHANGELOG.md`, `BUILD_TEST_LOG.md` per project rules.

---

## 7. Testing

**Backend (`DJANGO_TESTING=true`):**
- Create supply draft with `block_ids` (no weights) + `weight_net` + variety + harvest_status → persists; block_sources rows have null `weight_kg`; `weight_net` set; status `draft`.
- `skip_forecast_check=true` bypasses the 18,500 kg cap (a big total is accepted).
- Role gate: `loading_dept_head` allowed; a role outside the create gate → 403.
- **Join a supply draft that has null-weight blocks**: block_sources move to target, `target.weight_net` is **preserved** (not nulled by the sum recompute), source hard-deleted. (New assertion on the existing join contract.)
- Each audited consumer (weekly-plan rollup at minimum) has a null-weight case.

**Frontend:**
- `SupplyDraftModal` renders the fields; submit sends the right payload; validation blocks 0 blocks.
- Typecheck clean; existing suites green.

---

## 8. Out of scope (later phases / not now)
- **A/B — Join UI** on Detail and List (next phase; backend ready).
- **D — per-block weight editor** on Detail ("real loaded block source").
- Quota enforcement on the create-draft/join path (a pre-existing gap noted in `shipment-sheet.md:356`; not introduced or fixed here).
- Firm_splits in the supply modal.

---

## 9. Open questions / risks
1. **Consumer audit completeness** — the plan must grep-enumerate every reader of `block_sources.weight_kg`; a missed one that assumes non-null could 500 or miscompute. This is the main risk of the nullable change.
2. **`weight_net` semantics during the null-weight window** — while block weights are null, `weight_net` is the declared total and does NOT equal the block sum. That's intended; any UI that shows "sum of blocks vs weight_net" (e.g. a reconciliation check) must not flag it as a mismatch during this window.
3. **Harvest status values** — confirm `harvestStatus` option list is the right source for the modal (same one the Detail/goods group uses).
