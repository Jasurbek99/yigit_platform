# Handover — Sheet Settings as the Permission Authority (AD-17)

Branch `feat/sheet-permission-authority` — 40 commits, 38 files, +3336/-311.
**Not pushed. `main` untouched. Nothing merged.**

## What it does

`SheetRowSetting.role_triggers` is now the single authority for who may edit a Shipment Sheet cell,
replacing an arrangement where two tables had to agree and nothing kept them in sync. Row access is
granted in one place — the new **Row access** tab in Shipment Settings (pick a role, tick the rows) —
and `export_manager` can use it without an admin account.

Full decision record: `docs/ADR.md`, AD-17.

## Before you deploy

1. `python manage.py migrate` — applies `core/0038` (new resource) and `export/0065` (trigger backfill).
   **The backfill must land before the write-gate switch reaches an environment**, or roles that edit
   today purely through field grants lose write access.
2. **If `export/0065` has already run in that environment**, re-run the backfill by hand:
   `python manage.py backfill_sheet_row_triggers`. The junction-resource union was added after 0065
   was written, and a migration does not re-run.
3. Spot-check before letting users in:
   ```python
   from apps.core.permissions import get_sheet_edit_map
   from django.contrib.auth import get_user_model
   u = get_user_model().objects.get(role='boss')
   print([k for k, v in get_sheet_edit_map(u).items() if not v])   # expect []
   ```
4. If `seed_permissions --reset` is ever run afterwards, re-run `backfill_sheet_row_triggers`.

## Two access changes you are agreeing to

- **`document_team` gains the inline `block_sources` Sheet cell**, not just the endpoint it already had.
  Its pre-AD-17 grant was resource-level only, which allowed the endpoint but not the cell; a trigger
  unifies both answers. Correct under AD-17, and the more permissive resolution of a pre-existing split.
- **The packing union** gives `document_team` write on `packaging_kg` / `pallet_weight_kg` and the
  loading roles `packing_template`, none of which they held before. Unavoidable when one Sheet row owns
  a whole popover.

## Known and deliberately not fixed

- **F21** — `RoleSidebar` / `RowAccessTab` show raw role codes, untranslated.
- **F22** — `SheetRowsTab`'s UI gate reads `shipment.edit` while its endpoint gates on
  `sheet_row_setting`. Inert today: all three roles reaching the page hold both.
- **F23** — the Sheet's packing popover has no client-side gate. The backend refuses correctly, so a
  packing-only role gets a 403 toast instead of not being offered the click. UX, not security.
- **Per-user exceptions** (`triggered_user`, `user_permissions`) stay on the Sheet rows tab. "One place"
  holds for roles; moving per-person overrides is a follow-up.
- 39 minor findings were triaged by the final review as shippable — listed in
  `.superpowers/sdd/2026-09-02-sheet-settings-permission-authority/deferred-minors.md`.

## Decisions taken on your behalf

32 of them, each with its reasoning and what it costs if wrong:
`.superpowers/sdd/2026-09-02-sheet-settings-permission-authority/rulings.md`

The four with the widest blast radius:
- **Ruling 15/16** — the write gate distinguishes three states (no row, zero-config, configured-and-excluded)
  and only the third denies. The tempting one-liner would have resurrected the old authority for rows an
  admin deliberately configured to exclude a role.
- **Ruling 24** — `boss` had lost Shipment Settings write access; `core/0038` omitted him. Caught because
  tests seed and production migrates, and the two disagree.
- **Ruling 26** — the packing endpoint's `template` and `swap` scopes rewrite firm splits and quota, so
  they now require `firm_splits` as well as `packing`. Without this the branch shipped a privilege
  escalation with no client-side gate behind it.
- **Ruling 20** — a trigger on a soft-deleted row survives and returns if the row is restored. Left as is;
  stripping it would make restore lossy.

## Not committed

`docs/superpowers/plans/…` and `docs/superpowers/specs/…` for this work are untracked. They are the
design record; say the word if you want them in the branch.
