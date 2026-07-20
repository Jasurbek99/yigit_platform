"""Build the Word CMR overlay templates from the office's own Word form.

The CMR is a print overlay onto the pre-printed official 24-box form. Alongside
the geometry-preserving ``.xlsx`` (see ``build_cmr_xlsx.py``) the document team
wanted a **Word** output they can edit before printing.

The source of truth is the office's real Word CMR (``data/CMR_RU_template.docx``):
a flat sequence of positioned paragraphs — no tables — already laid out to land in
the blank form's free spaces. Rather than re-deriving that layout (an earlier
attempt built a Word table from the xlsx grid and got the positions right but the
formatting wrong), this builder keeps the office document **byte-for-byte as the
layout** and only swaps each sample value for a Jinja tag, leaving the fixed
labels (``Брутто:`` / ``кг.`` / ``вес поддона`` …) untouched.

The English variant reuses the same positioned layout with its labels translated
to match the ``CMR EN`` sheet's wording — the office has no separate EN Word form.

Run once to (re)create the committed templates:

    python -m apps.contracts.document_templates.build_cmr_docx [SOURCE_DOCX]
"""
from pathlib import Path
import sys

from docx import Document

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


def build(source: Path, lang: str) -> Path:
    doc = Document(source)
    paragraphs = doc.paragraphs

    replacements = dict(FIELD_TAGS)
    if lang == 'en':
        replacements.update(EN_LABELS)

    for index, text in replacements.items():
        if index >= len(paragraphs):
            raise ValueError(
                f'{source.name}: paragraph {index} missing — the office form changed; '
                'recheck FIELD_TAGS against its body order.'
            )
        _set_text(paragraphs[index], text)

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
