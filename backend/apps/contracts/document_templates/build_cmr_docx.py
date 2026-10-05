"""Build the Word CMR overlay templates from the office's own Word form.

The CMR is a print overlay onto the pre-printed official 24-box form, and the
Word file is what the office prints on it: every value sits in a page-anchored
frame at an absolute position, so the print lands the same from any PC. (The
``.xlsx`` variant places text by column widths, which change with the Windows
display scaling of the PC that prints it.)

The source is the office's real Word CMR (``data/CMR_RU_template.docx``): a flat
sequence of framed paragraphs, no tables. This builder keeps its formatting,
swaps each sample value for a Jinja tag, and moves every frame to the position
measured off the blank form in ``cmr_layout`` (the office's own positions put
the sender address and box 21 values across the form's borders). The fixed labels
(``Брутто:`` / ``кг.`` / ``вес поддона`` …) keep their text.

The English variant reuses the same positioned layout with its labels translated
to match the ``CMR EN`` sheet's wording — the office has no separate EN Word form.

Run once to (re)create the committed templates:

    python -m apps.contracts.document_templates.build_cmr_docx [SOURCE_DOCX]
"""
import copy
from pathlib import Path
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

from apps.contracts.document_templates import cmr_layout as layout

OUT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SOURCE = REPO_ROOT / 'data' / 'CMR_RU_template.docx'

# Paragraph index → replacement text, against the office form's body order.
# Indices NOT listed keep the source's fixed label verbatim (Брутто:, кг., …).
# Two-line blocks (address wraps) put the whole value on the first line and blank
# the continuation, since the rendered value carries its own length.
FIELD_TAGS: dict[int, str] = {
    0: '{{ sender1_name }}',
    1: '{{ sender1_address }}',
    2: '',
    3: '{{ sender2_name }}',
    4: '{{ sender2_address }}',
    5: '',
    6: '{{ consignee_name }}',
    7: '{{ consignee_address }}',
    8: '',
    9: '{{ country_destination }}',
    10: '{{ place_loading }}',
    11: '',                          # source split "велаят" / "этрап" across two runs
    12: '{{ country_dispatch }}',
    13: '{{ doc_date }}',
    14: '{{ invoice_refs }}',
    15: '{{ tir_line }}',
    16: '{{ cargo_name }}',
    19: '{{ boxes }}',
    20: '{{ packing }}',
    22: '{{ pallet_weight }}',
    24: '{{ pallets_line }}',
    26: '{{ gross_without_pallet }}',
    29: '{{ gross_with_pallet }}',
    31: '{{ net_line }}',            # value already carries its unit
    33: '{{ doc_date }}',
    34: '{{ driver_name }}',
    35: '{{ driver_passport }}',
    36: '{{ truck_model }}',
    37: '{{ plates }}',
}

# Fixed labels translated for the EN variant (same positions, English wording
# taken from the `CMR EN` sheet). Indices absent here keep the Russian source.
EN_LABELS: dict[int, str] = {
    17: 'GROSS:',
    18: 'NETTO:',
    21: 'pallet weight',
    23: 'kg.',
    25: 'gross weight without pallet',
    27: 'kg.',
    28: 'gross weight with pallet',
    30: 'kg.',
    32: 'Ashgabat city',
}

OUT_NAME = {'ru': 'cmr_ru_docx.docx', 'en': 'cmr_en_docx.docx'}


def _at(key: str, nth: int = 0) -> layout.Field:
    """The ``nth`` layout field with this key (labels like ``kg`` repeat)."""
    return [f for f in layout.FIELDS if f.key == key][nth]


# Box 17 (successive carrier) has no paragraph in the office form; one is
# appended, cloned from the country line so it carries the same run formatting.
BOX17_INDEX = 38
BOX17_SOURCE = 9

# Paragraph index → the measured position its frame takes. The continuation
# paragraphs (2, 5, 8, 11) stay empty and are left where they are; a wrapped
# value flows inside its own frame instead.
FRAMES: dict[int, layout.Field] = {
    0: _at('sender1_name'),
    1: _at('sender1_address'),
    3: _at('sender2_name'),
    4: _at('sender2_address'),
    6: _at('consignee_name'),
    7: _at('consignee_address'),
    9: _at('country_destination'),
    # The Word form prints region + etrap from one tag across both halves.
    10: _at('place_region')._replace(key='place_loading', x1=_at('place_district').x1),
    12: _at('country_dispatch'),
    13: _at('doc_date'),
    14: _at('invoice_refs'),
    15: _at('tir_line'),
    16: _at('cargo_name'),
    17: _at('label:gross'),
    18: _at('label:net'),
    19: _at('boxes'),
    20: _at('packing'),
    21: _at('label:pallet_weight'),
    22: _at('pallet_weight'),
    23: _at('label:kg', 0),
    24: _at('pallets_line'),
    25: _at('label:gross_without_pallet'),
    26: _at('gross_without_pallet'),
    27: _at('label:kg', 1),
    28: _at('label:gross_with_pallet'),
    29: _at('gross_with_pallet'),
    30: _at('label:kg', 2),
    31: _at('net_line'),
    32: _at('label:city'),
    33: _at('doc_date', 1),
    34: _at('driver_name'),
    35: _at('driver_passport'),
    36: _at('truck_model'),
    37: _at('plates'),
    BOX17_INDEX: _at('successive_carrier'),
}

# Exact line pitch = the form's writing-line pitch, so wrapped lines (addresses)
# land on consecutive dotted lines.
LINE_PITCH_PT = 13.5
TWIPS_PER_MM = 1440 / 25.4
# Word draws a line of exact height with the baseline this far below its top;
# measured on a Word PDF export of this template (+0.4 mm so text sits just
# above the dotted line rather than on it).
BASELINE_MM = 4.3
_ALIGN = {
    'left': WD_ALIGN_PARAGRAPH.LEFT, 'center': WD_ALIGN_PARAGRAPH.CENTER,
    'right': WD_ALIGN_PARAGRAPH.RIGHT,
}


def _set_text(paragraph, text: str) -> None:
    """Replace a paragraph's text, preserving the first run's formatting.

    Writing to ``paragraph.text`` would drop the run properties (font, size,
    spacing) that position this line on the form, so the first run is rewritten
    in place and the remaining runs are emptied.
    """
    if not paragraph.runs:
        if text:
            paragraph.add_run(text)
        return
    paragraph.runs[0].text = text
    for run in paragraph.runs[1:]:
        run.text = ''


def _twips(mm: float) -> str:
    return str(round(mm * TWIPS_PER_MM))


def _place(paragraph, field: layout.Field) -> None:
    """Move a framed paragraph to a field's measured position on the paper."""
    frame = paragraph._p.pPr.find(qn('w:framePr'))
    frame.set(qn('w:x'), _twips(field.x0))
    frame.set(qn('w:y'), _twips(field.first - BASELINE_MM))
    frame.set(qn('w:w'), _twips(field.x1 - field.x0))
    frame.set(qn('w:h'), str(round(LINE_PITCH_PT * 20)))
    frame.set(qn('w:hRule'), 'atLeast')
    fmt = paragraph.paragraph_format
    fmt.line_spacing = Pt(LINE_PITCH_PT)
    fmt.alignment = _ALIGN[field.align]
    for run in paragraph.runs:
        run.font.size = Pt(field.size)


def build(source: Path, lang: str) -> Path:
    doc = Document(source)
    last = doc.paragraphs[-1]._p
    last.addnext(copy.deepcopy(doc.paragraphs[BOX17_SOURCE]._p))
    paragraphs = doc.paragraphs

    replacements = {**FIELD_TAGS, BOX17_INDEX: '{{ successive_carrier }}'}
    if lang == 'en':
        replacements.update(EN_LABELS)

    for index, text in replacements.items():
        if index >= len(paragraphs):
            raise ValueError(
                f'{source.name}: paragraph {index} missing — the office form changed; '
                'recheck FIELD_TAGS against its body order.'
            )
        _set_text(paragraphs[index], text)
    for index, field in FRAMES.items():
        _place(paragraphs[index], field)

    out = OUT_DIR / OUT_NAME[lang]
    doc.save(out)
    return out


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        raise SystemExit(f'Source Word form not found: {source}')
    for lang in ('ru', 'en'):
        print(f'wrote {build(source, lang)}')


if __name__ == '__main__':
    main()
