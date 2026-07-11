"""Generate the invoice ``.docx`` templates (Jinja-tagged for docxtpl).

Run once to (re)create ``invoice_ru.docx`` / ``invoice_en.docx``:

    python -m apps.contracts.document_templates.build_templates

The produced ``.docx`` files are the source-of-truth layouts committed to git.
Static labels (ИНВОЙС/INVOICE, ПРОДАВЕЦ/SELLER, table headers …) are baked into
each language file; only data values are ``{{ jinja }}`` tags, filled at runtime
by ``apps.contracts.services.document_render``.

NOTE: once a human refines a template in Word, that ``.docx`` is authoritative —
re-running this overwrites it. Only re-run to intentionally reset a template.
"""
from pathlib import Path

from docx import Document
from docx.enum.table import WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

OUT_DIR = Path(__file__).resolve().parent

# Per-language static label set. Data values stay as Jinja tags shared by both.
# The invoice .docx mirrors the office Excel sheet (InvoiceRU / InvoiceEN): a first
# INVOICE page and a second PACKING-LIST page ("Упаковочный лист" / "Packing List")
# that repeats the parties/route but drops the price columns.
LABELS = {
    'ru': {
        'title': 'ИНВОЙС (счет фактура)',
        'packing_title': 'Упаковочный лист',
        'number_line': '№ {{ invoice_no }} от   {{ invoice_date }}',
        'contract_line': 'Контракт № {{ contract_line }}',
        'seller': 'ПРОДАВЕЦ:',
        'buyer': 'ПОКУПАТЕЛЬ:',
        'country': 'Страна происхождение товара:',
        'loading': 'Место погрузки груза:',
        'delivery': 'Условие поставки:',
        'transport': 'Вид транспорта: Авто:',
        'cols': ['№', 'Наименование товара', 'Код по ТН ВЭД', 'Кол-во мест',
                 'Род упаковки', 'Брутто', 'Нетто',
                 'Цена долл.США за 1 кг', 'Сумма долл.США'],
        'packing_cols': ['№', 'Наименование товара', 'Код по ТН ВЭД',
                         'Кол-во мест', 'Брутто', 'Нетто'],
        'total': 'ИТОГО:',
        'seller_foot': 'ПРОДАВЕЦ',
        'released': 'Товар отпустил: __________________{{ seller_name }}',
        'sign': '(подпись лица)',
    },
    'en': {
        'title': 'INVOICE',
        'packing_title': 'Packing List',
        'number_line': '№ {{ invoice_no }}, {{ invoice_date }}',
        'contract_line': 'Contract № {{ contract_line }}',
        'seller': 'SELLER:',
        'buyer': 'BUYER:',
        'country': 'Country of origin:',
        'loading': 'Place of loading cargo:',
        'delivery': 'Delivery conditions:',
        'transport': 'Type of transport: Auto:',
        'cols': ['№', 'Name of product', 'Code on TN FEA', 'Number of pieces',
                 'Type of packing', 'Gross weight, kg', 'Net weight, kg',
                 'Price of US dollars kg', 'Total price of US dollars'],
        'packing_cols': ['№', 'Name of product', 'Code on TN FEA',
                         'Number of pieces', 'Gross weight, kg', 'Net weight, kg'],
        'total': 'TOTAL:',
        'seller_foot': 'SELLER',
        'released': ' __________________{{ seller_name }}',
        'sign': '(signature)',
    },
}

# Data field per invoice column (9-col invoice table / 6-col packing table).
_INVOICE_FIELDS = ['n', 'name', 'code', 'pieces', 'packing', 'gross', 'net', 'price', 'total']
_PACKING_FIELDS = ['n', 'name', 'code', 'pieces', 'gross', 'net']


def _set_cell(cell, text, bold=False, size=9, italic=False):
    cell.text = ''
    run = cell.paragraphs[0].add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)


def _no_border(cell) -> None:
    """Strip all borders from a single cell (used for the spacer between boxes)."""
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'nil')
        borders.append(el)
    tc_pr.append(borders)


def _col_widths(table, widths) -> None:
    """Pin column widths (python-docx needs each cell set, autofit off)."""
    table.autofit = False
    table.allow_autofit = False
    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            cell.width = width


def _a4(doc) -> None:
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(2)
    section.right_margin = Cm(1.5)


def _header(doc, lab, title_text: str) -> None:
    """Centered title + № line + contract line (shared by both invoice pages)."""
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run(title_text)
    r.bold = True
    r.font.size = Pt(13)
    for key in ('number_line', 'contract_line'):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(lab[key]).bold = True
    doc.add_paragraph()


def _fill_party_cell(cell, name_tag: str, addr_tag: str, bank_tag: str) -> None:
    """Firm box: name (top, bold), address, gap, then multi-line bank block.

    ``bank_tag`` resolves to the firm's bank-details blob whose embedded ``\\n``
    docxtpl renders as line breaks — so the box mirrors the Excel requisites list.
    """
    cell.text = ''
    top = cell.paragraphs[0].add_run(name_tag)
    top.bold = True
    top.font.size = Pt(10)
    cell.add_paragraph().add_run(addr_tag).font.size = Pt(9)
    for _ in range(3):
        cell.add_paragraph()
    cell.add_paragraph().add_run(bank_tag).font.size = Pt(8)


def _party_block(doc, lab) -> None:
    """ПРОДАВЕЦ / ПОКУПАТЕЛЬ labels over two tall bordered firm boxes with a gap."""
    widths = [Cm(8), Cm(1.5), Cm(8)]
    labels = doc.add_table(rows=1, cols=3)
    _col_widths(labels, widths)
    _set_cell(labels.cell(0, 0), lab['seller'], bold=True, size=10)
    _set_cell(labels.cell(0, 2), lab['buyer'], bold=True, size=10)

    boxes = doc.add_table(rows=1, cols=3)
    boxes.style = 'Table Grid'
    _col_widths(boxes, widths)
    boxes.rows[0].height = Cm(8)
    boxes.rows[0].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
    _fill_party_cell(boxes.cell(0, 0), '{{ seller_name }}', '{{ seller_address }}', '{{ seller_bank }}')
    _no_border(boxes.cell(0, 1))
    _fill_party_cell(boxes.cell(0, 2), '{{ buyer_name }}', '{{ buyer_address }}', '{{ buyer_bank }}')


def _info_block(doc, lab) -> None:
    """Route rows: origin / place of loading / delivery terms / transport."""
    rows = (
        (lab['country'], '{{ country_origin }}'),
        (lab['loading'], '{{ place_loading }}'),
        (lab['delivery'], '{{ delivery_terms }}'),
        (lab['transport'], '{{ transport }}'),
    )
    table = doc.add_table(rows=len(rows), cols=2)
    _col_widths(table, [Cm(6), Cm(11.5)])
    for i, (label, tag) in enumerate(rows):
        _set_cell(table.rows[i].cells[0], label, size=10)
        _set_cell(table.rows[i].cells[1], tag, size=10)
    doc.add_paragraph()


def _items_table(doc, cols, fields, total_label=None) -> None:
    """Bordered line-items table: header + one product row (+ optional ИТОГО row).

    ``line_items`` stays a list so a future multi-row template can switch to a
    docxtpl row loop; today invoices are one product line in practice.
    """
    rows = 2 + (1 if total_label else 0)
    table = doc.add_table(rows=rows, cols=len(cols))
    table.style = 'Table Grid'
    for i, name in enumerate(cols):
        _set_cell(table.rows[0].cells[i], name, bold=True, size=8)
    body = table.rows[1].cells
    for i, fld in enumerate(fields):
        _set_cell(body[i], f'{{{{ line_items[0].{fld} }}}}', size=9)
    if total_label:
        total_cells = table.rows[2].cells
        _set_cell(total_cells[1], total_label, bold=True)
        _set_cell(total_cells[len(cols) - 1], '{{ total_sum }}', bold=True)


def _footer(doc, lab) -> None:
    """Pallet note + seller signature block (shared by both invoice pages)."""
    note = doc.add_paragraph()
    note.add_run('{{ pallet_note }}').italic = True
    doc.add_paragraph()
    doc.add_paragraph().add_run(lab['seller_foot']).bold = True
    doc.add_paragraph().add_run(lab['released']).bold = True
    sign = doc.add_paragraph()
    sign.add_run(lab['sign']).italic = True


def build(lang: str) -> Path:
    lab = LABELS[lang]
    doc = Document()
    doc.styles['Normal'].font.size = Pt(10)
    _a4(doc)

    # Page 1 — INVOICE (with price columns and ИТОГО total).
    _header(doc, lab, lab['title'])
    _party_block(doc, lab)
    doc.add_paragraph()
    _info_block(doc, lab)
    _items_table(doc, lab['cols'], _INVOICE_FIELDS, total_label=lab['total'])
    _footer(doc, lab)

    # Page 2 — PACKING LIST (same header/parties/route, weights only, no prices).
    doc.add_page_break()
    _header(doc, lab, lab['packing_title'])
    _party_block(doc, lab)
    doc.add_paragraph()
    _info_block(doc, lab)
    _items_table(doc, lab['packing_cols'], _PACKING_FIELDS)
    _footer(doc, lab)

    out = OUT_DIR / f'invoice_{lang}.docx'
    doc.save(out)
    return out


# NOTE: the CMR is NOT built here — it is an xlsx print-overlay onto the
# pre-printed official form (geometry python-docx can't reproduce). See
# ``build_cmr_xlsx.py`` and ``document_context.build_cmr_overlay``.


# Authority request letters — short single-language forms. Static addressee/body
# boilerplate baked in; only the named {{ fields }} are injected at render time.
LETTERS = {
    'ct1_ru': {
        'addressee': ['Директору предприятия', '«Туркменэкспертиза» ТПП', 'в Туркменистане'],
        'title': None,
        'body': ('{{ firm_name }} просит Вас оформить сертификат происхождения '
                 'формы «СТ-1», на {{ product }}. Контракт № {{ contract_line }}.'),
        'sign': 'Директор ___________________ {{ firm_name }}',
    },
    'fito_ru': {
        'addressee': ['Гос. служба по карантину', 'растений Ахалского велаята'],
        'title': None,
        'body': ('{{ firm_name }} просит Вас оформить Фитосанитарный сертификат на груз, '
                 'направляемый в {{ country }}. Вес груза нетто {{ net }} кг., '
                 'ящиков — {{ boxes }} шт., на {{ product }}.'),
        'sign': 'Директор ___________________ {{ firm_name }}',
    },
    'customs_tk': {
        'addressee': ['Aşgabat gümrükhanasynyň', '«AKÝOL» gümrük nokadynyň', 'müdirine'],
        'title': 'ARZA',
        'body': ('{{ seller_name }} bilen {{ buyer_name }} arasynda {{ contract_line }} '
                 'senede baglaşylan şertnama boýunça ýükümizi {{ country }} Respublikasyna '
                 'çykarmak üçin gümrük gözegçisini bermegiňizi Sizden haýyş edýäris.'),
        'sign': 'Direktor ___________________ {{ seller_name }}',
    },
}


def build_letter(key: str) -> Path:
    spec = LETTERS[key]
    doc = Document()
    doc.styles['Normal'].font.size = Pt(11)

    for line in spec['addressee']:
        p = doc.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT

    doc.add_paragraph()
    if spec['title']:
        t = doc.add_paragraph()
        t.alignment = WD_ALIGN_PARAGRAPH.CENTER
        t.add_run(spec['title']).bold = True
        doc.add_paragraph()

    body = doc.add_paragraph(spec['body'])
    body.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    doc.add_paragraph()
    doc.add_paragraph('{{ doc_date }}')
    doc.add_paragraph(spec['sign'])

    out = OUT_DIR / f'{key}.docx'
    doc.save(out)
    return out


def main() -> None:
    for lang in ('ru', 'en'):
        print(f'wrote {build(lang)}')
    for key in LETTERS:
        print(f'wrote {build_letter(key)}')


if __name__ == '__main__':
    main()
