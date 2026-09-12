"""Build the TIR carnet overlay templates (``tir_ru.xlsx`` / ``tir_ru_2drivers.xlsx``).

Like the CMR — and unlike the invoice/contract/letters — the TIR carnet is a
**print overlay**: data positioned to print on top of the pre-printed carnet page
the office already holds. The source sheets carry no borders or frames of their
own in the printed region (columns A–I); every line the operator sees on paper
comes from the carnet itself. The workbook only supplies the geometry — column
widths, row heights, A4 portrait @ 90% scale — that makes each value land in its
printed box.

The source workbook has two sheets that differ in exactly two printed respects:

  * ``TIR CARNET1`` carries a SECOND driver pair (boxes 5/6 at ``D4``/``D5``);
    ``TIR CARNET (RUS Belarus)`` has one driver only.
  * rows 10 and 12 have different heights (22.5/18.8 vs 12.0/25.5), which shifts
    everything below row 12 by ~4pt on paper.

That vertical shift is why these are two committed templates rather than one with
conditional cells: a single grid cannot register both layouts on the physical page.

Everything else — column widths, the printed field coordinates, the merge set —
is identical between them.

This builder strips each source sheet to a clean template:
  * every value in the printed region (A–I) is blanked EXCEPT the three fixed
    lines of the haulier block (``KEEP_LABELS``). The box-number prefixes
    (``1. ``, ``2. ``, ``3. ``) were baked into the source's data strings; the
    context builder prepends them instead, so no data survives the strip,
  * the helper input columns (K onward) are cleared of values AND of the
    green/yellow fills and borders that marked them as operator inputs. They sit
    outside the print area, but the office asked for them gone — nothing on this
    sheet is typed into it any more,
  * ``print_area`` is set explicitly. Neither source sheet defines one, and their
    row heights run to row 999, so an unconstrained export would span pages of
    blank rows and never register.

Run once to (re)create the committed templates:

    python -m apps.contracts.document_templates.build_tir_xlsx [SOURCE_XLSX]
"""
from pathlib import Path
import sys

import openpyxl
from openpyxl.cell.cell import MergedCell
from openpyxl.styles import Border, PatternFill

OUT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SOURCE = REPO_ROOT / 'data' / 'tir_carnet.xlsx'

MAX_ROW = 120

# The printed content ends at row 44 (the counterfoil repeat of destination and
# box count). Rows 45+ carry font styling but no values.
PRINT_AREA = 'A1:I44'

# First helper column (K, 1-indexed 11). Everything from here rightward was the
# operator's green/yellow input block and scratch notes; it is stripped of both
# values and the fills/borders that marked it.
FIRST_HELPER_COL = 11

# The haulier block (B2:B5) reads down the column as one organisation name:
# a fixed first line, the BORDER POINT, then a fixed 'awto' / 'ýollary'. Only the
# border-point line is data, so the other three stay as template labels — which
# also means they print black while the filled line prints red.
KEEP_LABELS = frozenset({'B2', 'B4', 'B5'})

OUT_NAME = {
    'TIR CARNET (RUS Belarus)': 'tir_ru.xlsx',
    'TIR CARNET1': 'tir_ru_2drivers.xlsx',
}


def _clean_sheet(ws) -> None:
    """Blank every value but the fixed haulier lines, and de-mark the helper block."""
    for row in ws.iter_rows(min_row=1, max_row=MAX_ROW):
        for cell in row:
            # The helper block merges several cells (K28:L28 …). A merged child is
            # read-only and carries nothing of its own — clearing the anchor is
            # enough, and touching the child raises.
            if isinstance(cell, MergedCell):
                continue
            if cell.column >= FIRST_HELPER_COL:
                cell.value = None
                # openpyxl shares style objects between cells, so reset through the
                # named defaults rather than mutating the fill/border in place.
                cell.fill = PatternFill()
                cell.border = Border()
            elif cell.coordinate not in KEEP_LABELS and cell.value not in (None, ''):
                cell.value = None


def build(source: Path, sheet_name: str) -> Path:
    # data_only so nothing survives as a formula — the source sheet drives cells
    # such as C44/D44 off other cells, and a template must not carry references.
    wb = openpyxl.load_workbook(source, data_only=True)
    for name in list(wb.sheetnames):
        if name != sheet_name:
            del wb[name]
    ws = wb[sheet_name]
    _clean_sheet(ws)
    # Constrain the export to the carnet's content grid so the 90%-scale overlay
    # lands on one page instead of trailing ~955 empty rows.
    ws.print_area = PRINT_AREA
    out = OUT_DIR / OUT_NAME[sheet_name]
    wb.save(out)
    return out


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        raise SystemExit(f'Source workbook not found: {source}')
    for sheet_name in OUT_NAME:
        print(f'wrote {build(source, sheet_name)}')


if __name__ == '__main__':
    main()
