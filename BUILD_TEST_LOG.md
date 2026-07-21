# Build / Test Log

Running record of things Claude built that still need **manual testing by you**.

- Claude appends an entry every time it builds or meaningfully changes a feature/fix.
- Each new entry starts as `- [ ]` (NEEDS TEST).
- After **you** test it, check it off: change `- [ ]` to `- [x]` (or tell Claude "tested X" and it will check it off).
- The Stop hook counts open `- [ ]` items and reminds you if any are pending.

Format: `- [ ] YYYY-MM-DD — <what was built> — NEEDS TEST`

---

- [ ] 2026-07-21 — ShipmentDetail redesign (completeness bar, stage cards, click-to-edit, comments, route rail) — NEEDS TEST
- [ ] 2026-07-21 — Shipment Detail (Task 11): removed the placeholder Links card (Logo Tiger / Trip Management / GPS — hardcoded rows, no real data) from the detail page's column-3 block; it now shows only the route rail. Also split `DetailFieldRow.tsx` into 4 files (behavior-preserving refactor, 111 pre-existing tests pass unchanged, no visual change intended there). **The Links card removal is a layout change with no automated coverage — please look at a shipment detail page and confirm column 3 reads fine with just the route rail.** — NEEDS TEST
- [ ] 2026-07-21 — Shipment Detail (Task 9): comments brought onto the detail page — hero "Discussion" button (whole-shipment thread, badge = root comment count) + per-field 💬 icon on every row (opens that field's thread, shows a live count). Reuses the Sheet's CommentsDrawer (moved to `components/comments/`), pinned to the viewport via a new `CommentsDrawerOverlay` wrapper. I ran a live end-to-end pass myself (logged in as admin on shipment 549: opened both thread types, posted a field-pinned comment, confirmed the count updated without reload, confirmed the drawer stays docked while scrolling) — but that's agent verification, not yours. **Please click through it yourself before checking this off.** — NEEDS TEST
- [ ] 2026-07-20 — Shipment Detail redesign (Task 7): accordion replaced with always-open stage cards in a 2-column grid + route rail. All 6 field groups visible at once (Destination / Documents / Loading / Transit / Notes cards, Sale full-width). Rows the backend reports as missing are highlighted amber; completeness-bar chips jump to and open the field. LifecycleStage removed. **Check visually in a browser — layout not yet verified against real data.** — NEEDS TEST
- [x] 2026-07-20 — Sheet page: hovering/navigating to a cell no longer washes out its text (hover now layers a translucent blue instead of replacing the painted background with `--blue-50 !important`; editing cell resets the inherited light `--col-tint-fg`) — NEEDS TEST

- [x] 2026-07-20 — /me/board task drawer: progress bar now updates live after editing a field (fixed number-vs-string shipment detail query key + added detail invalidation to junction/custom-field saves) — NEEDS TEST

- 2026-07-16 — Loading tasks repointed `warehouse_chief` → `loading_dept_head` (both `fill_loading_data` + `trigger_loading_start`), plus new deputy role-equivalence (`task_roles_for`) so Soltanmyrat's 5 deputies both **see** and can **act on** his loading tasks. Rules already re-seeded + reconciled on the live DB (2 open tasks moved; 146 done left as history). Verify: log in as a **deputy** (jumanyyazg / nepesk / hudaynazary / yalkapa / azatbayd) → the loading task appears on **My tasks** AND the drawer lets them start/complete it (not a read-only card). Also confirm a **weight_master** does NOT see it. — NEEDS TEST
- 2026-07-16 — "My tasks" role filter for supervisors: supervisor-only role `Select` on the My tasks page + server-side `?assignee_role=` on `/me/tasks/` and `/me/kpi-today/` (KPI tiles follow the selected role). Verify: as admin open **My tasks**, pick a role (e.g. Document Team) → only that role's cards, KPI tiles change, network shows `assignee_role=document_team`; clear → all roles return. Then log in as a **non-supervisor** (e.g. transport) and confirm the dropdown does **not** appear. Note: with no role selected the list is still truncated at 1000 of 1213 — pre-existing, not fixed here. — NEEDS TEST
- 2026-07-15 — Sales report as a sales-rep task: step-4 (`yola_chykdy`) `MANUAL_DONE` "submit sales report" reminder + retargeted `satyldy → tamamlandy` trigger (`sales_report_date` → `sales_report` existence) + `close_sales_report_task` wired into the `set_sales_report` endpoint + `backfill_sales_report_tasks` command. Verify on beta: run `seed_task_rules` then `backfill_sales_report_tasks --dry-run` (review counts) → apply; confirm reps see the reminder on the board from departure, filling a report closes it, and a satyldy shipment with a report advances to tamamlandy. — NEEDS TEST

## Pending & tested

- 2026-07-10 — Weightmaster→finance Phase 3: sales-report Processing tab shows read-only block×variety breakdown card; weekly-plan actual (`rollup_actuals`) now buckets by shipment_code date + folds sub-blocks to parent — NEEDS TEST
- 2026-07-10 — Standalone Weightmaster page (`/export/weightmaster`): LOADING-phase truck queue + picker + inline pallet manifest — NEEDS TEST
- 2026-07-10 — Weightmaster Excel upload → pallet manifest (dry-run preview) + parent-grain block_sources rollup on manifest close; backfill cmd `normalize_block_sources` — NEEDS TEST