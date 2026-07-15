# Build / Test Log

Running record of things Claude built that still need **manual testing by you**.

- Claude appends an entry every time it builds or meaningfully changes a feature/fix.
- Each new entry starts as `- [ ]` (NEEDS TEST).
- After **you** test it, check it off: change `- [ ]` to `- [x]` (or tell Claude "tested X" and it will check it off).
- The Stop hook counts open `- [ ]` items and reminds you if any are pending.

Format: `- [ ] YYYY-MM-DD — <what was built> — NEEDS TEST`

---

## Pending & tested

<!-- newest entries on top -->

- [ ] 2026-07-15 — Generate-contract modal: "With stamps" checkbox (`?stamps=1`, default unchecked); ExportFirm admin page gets Signature & Seal upload UI (director_signature/director_seal, mirroring ImportFirm) — NEEDS TEST
- [ ] 2026-07-10 — Weightmaster→finance Phase 3: sales-report Processing tab shows read-only block×variety breakdown card; weekly-plan actual (`rollup_actuals`) now buckets by shipment_code date + folds sub-blocks to parent — NEEDS TEST
- [ ] 2026-07-10 — Standalone Weightmaster page (`/export/weightmaster`): LOADING-phase truck queue + picker + inline pallet manifest — NEEDS TEST
- [ ] 2026-07-10 — Weightmaster Excel upload → pallet manifest (dry-run preview) + parent-grain block_sources rollup on manifest close; backfill cmd `normalize_block_sources` — NEEDS TEST
- [ ] 2026-07-15 — Build/test reminder system: BUILD_TEST_LOG.md, CLAUDE.md logging rule, Stop hook in .claude/settings.json, scheduled reminder — NEEDS TEST
