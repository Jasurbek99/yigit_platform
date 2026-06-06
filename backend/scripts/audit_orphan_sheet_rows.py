"""B.2 — Orphan sheet row audit.

Checks every editable row in DEFAULT_SHEET_ROWS to confirm its field_key is
either in _ALL_PATCHABLE_FIELDS (writable via /shipments/:id/ PATCH) or in
the known-nested set (block_sources, firm_splits, etc., handled by their own
endpoints).

Run from backend/:  python scripts/audit_orphan_sheet_rows.py

Exit 0 if no orphans found, 1 if any orphans surface. Prints a table of
suspect rows so they can be fixed before beta launch.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Bootstrap path so we can import from apps.export without Django app loading
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from apps.export.sheet_rows import DEFAULT_SHEET_ROWS  # noqa: E402

# Re-extract the whitelist from serializers.py without importing it (avoids
# pulling in Django settings just to read a set literal).
import ast
import re

_SERIALIZER_PATH = BACKEND_DIR / 'apps' / 'export' / 'serializers.py'
_SOURCE = _SERIALIZER_PATH.read_text(encoding='utf-8')


def _extract_patchable_fields() -> set[str]:
    """Pull _ALL_PATCHABLE_FIELDS literally out of serializers.py."""
    match = re.search(
        r'_ALL_PATCHABLE_FIELDS\s*=\s*(\{[^}]+\})',
        _SOURCE,
        flags=re.DOTALL,
    )
    if not match:
        raise RuntimeError('Could not locate _ALL_PATCHABLE_FIELDS in serializers.py')
    raw = match.group(1)
    # Strip Python comments before ast.literal_eval — it doesn't tolerate them.
    cleaned = re.sub(r'#[^\n]*', '', raw)
    return set(ast.literal_eval(cleaned))


PATCHABLE = _extract_patchable_fields()

# Input types that render an editor in the Sheet — picking a value MUST persist.
EDITABLE_TYPES = {'text', 'number', 'date', 'datetime', 'dropdown', 'status', 'phone'}

# Known nested resources — written via their own endpoints, not the flat PATCH.
KNOWN_NESTED = {
    'block_sources',
    'firm_splits',
    'quality',
    'comments',
    'extra_users',
}

# Virtual combined cells — display + edit two real fields under one virtual
# field_key. Frontend SheetCellEditor special-cases the field_key and PATCHes
# the real fields directly; the virtual key itself has no DB column. Perm
# delegation lives in can_edit_sheet_field. See docs/obsidian/screens/shipment-sheet.md R26.
KNOWN_VIRTUAL = {
    'transit_days_temp',  # → transit_days + transport_temp_c
}

orphans: list[tuple[int, str, str, str]] = []

for row in DEFAULT_SHEET_ROWS:
    if row['input_type'] not in EDITABLE_TYPES:
        continue
    fk = row['field_key']
    if fk in KNOWN_NESTED:
        continue
    if fk in KNOWN_VIRTUAL:
        continue
    if fk not in PATCHABLE:
        orphans.append((
            row['row_number'],
            fk,
            row['input_type'],
            row.get('label_key', ''),
        ))

if orphans:
    print(f'\nORPHAN ROWS FOUND ({len(orphans)}):\n')
    print(f"  {'Row':>4}  {'Type':<9}  {'field_key':<35}  label_key")
    print(f"  {'---':>4}  {'-' * 9}  {'-' * 35}  {'-' * 30}")
    for r, fk, t, lk in orphans:
        print(f'  R{r:<3}  {t:<9}  {fk:<35}  {lk}')
    print()
    print('Each row above renders an editor in the Sheet but its field_key')
    print('is missing from _ALL_PATCHABLE_FIELDS — saves are silently dropped.')
    print('Fix: add the field to _ALL_PATCHABLE_FIELDS + the Shipment model +')
    print("the relevant role's seed_permissions OR flip the row to readonly.")
    sys.exit(1)

print(f'OK — all {sum(1 for r in DEFAULT_SHEET_ROWS if r["input_type"] in EDITABLE_TYPES)} editable rows resolve to fields in _ALL_PATCHABLE_FIELDS or known-nested resources.')
sys.exit(0)
