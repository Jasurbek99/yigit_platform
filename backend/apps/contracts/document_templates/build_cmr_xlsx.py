"""Build the CMR overlay templates (``cmr_ru.xlsx`` / ``cmr_en.xlsx``).

The office CMR is a **print overlay**: data printed on top of the pre-printed
official CMR form. The form's paper is ~204 × 290 mm, not A4, so the sheet is
generated from the measured layout in ``cmr_layout`` rather than copied from the
office workbook (whose A4 @ 60% grid put several values on the form's labels).

Each field becomes one merged cell at its measured position; the grid's columns
and rows are just the union of all field edges. The page prints on A4 at 100%
with the left/top margins equal to ``cmr_layout.ORIGIN_MM``, so every value lands
at its millimetre position measured from the paper's top-left corner. If a print
is shifted on the blank, changing those two margins in Excel moves everything.

Values are filled at render time by coordinate (``document_render.render_xlsx`` +
``document_context.build_cmr_overlay``); only the fixed labels are baked in.

Run once to (re)create the committed templates:

    python -m apps.contracts.document_templates.build_cmr_xlsx
"""
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

from apps.contracts.document_templates import cmr_layout as layout

OUT_DIR = Path(__file__).resolve().parent
OUT_NAME = {'ru': 'cmr_ru.xlsx', 'en': 'cmr_en.xlsx'}
SHEET_TITLE = {'ru': 'CMR RU', 'en': 'CMR EN'}

FONT_NAME = 'Times New Roman'
# Excel column width is in characters of the Normal font's widest digit; the
# default Normal font (Calibri 11) has a 7 px max digit width at 96 dpi.
MAX_DIGIT_PX = 7
MM_PER_INCH = 25.4


def _col_width(px: int) -> float:
    """Excel column width (characters) that renders as exactly ``px`` pixels."""
    return ((px + 0.5) * 256 / MAX_DIGIT_PX - 128 // MAX_DIGIT_PX) / 256


def _size_grid(ws) -> None:
    for i in range(1, len(layout.COL_PX)):
        width_px = layout.COL_PX[i] - layout.COL_PX[i - 1]
        ws.column_dimensions[get_column_letter(i)].width = _col_width(width_px)
    for i in range(1, len(layout.ROW_PX)):
        ws.row_dimensions[i].height = (layout.ROW_PX[i] - layout.ROW_PX[i - 1]) * 0.75


def _place_fields(ws, lang: str) -> None:
    taken: set[tuple[int, int]] = set()
    for field in layout.FIELDS:
        top_left, bottom_right = layout.cell_range(field)
        area = ws[f'{top_left}:{bottom_right}']
        cells = {(c.row, c.column) for row in area for c in row}
        if cells & taken:
            raise ValueError(f'CMR layout: {field.key} overlaps another field')
        taken |= cells
        if top_left != bottom_right:
            ws.merge_cells(f'{top_left}:{bottom_right}')
        cell = ws[top_left]
        cell.font = Font(name=FONT_NAME, size=field.size)
        wrapped = field.last is not None
        cell.alignment = Alignment(
            horizontal=field.align, vertical='top' if wrapped else 'bottom',
            wrap_text=wrapped, shrink_to_fit=not wrapped,
        )
        if field.key.startswith('label:'):
            cell.value = layout.LABELS[lang][field.key.removeprefix('label:')]


def _set_page(ws) -> None:
    """A4 at 100%: any fit/scale setting would shrink the layout off the boxes."""
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.scale = 100
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=False)
    origin_in = layout.ORIGIN_MM / MM_PER_INCH
    margins = ws.page_margins
    margins.left = margins.top = origin_in
    margins.right = margins.bottom = margins.header = margins.footer = 0
    ws.print_options.horizontalCentered = False
    ws.print_options.verticalCentered = False
    last_col = get_column_letter(len(layout.COL_PX) - 1)
    ws.print_area = f'A1:{last_col}{len(layout.ROW_PX) - 1}'


def build(lang: str) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET_TITLE[lang]
    _size_grid(ws)
    _place_fields(ws, lang)
    _set_page(ws)
    out = OUT_DIR / OUT_NAME[lang]
    wb.save(out)
    return out


def main() -> None:
    for lang in ('ru', 'en'):
        print(f'wrote {build(lang)}')


if __name__ == '__main__':
    main()
