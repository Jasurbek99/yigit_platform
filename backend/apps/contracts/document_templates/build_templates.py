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
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

OUT_DIR = Path(__file__).resolve().parent

# Per-language static label set. Data values stay as Jinja tags shared by both.
LABELS = {
    'ru': {
        'title': 'ИНВОЙС (счёт-фактура)',
        'number_line': '№ {{ invoice_no }} от {{ invoice_date }}',
        'contract_line': 'Контракт № {{ contract_line }}',
        'seller': 'ПРОДАВЕЦ:',
        'buyer': 'ПОКУПАТЕЛЬ:',
        'country': 'Страна происхождения товара:',
        'loading': 'Место погрузки груза:',
        'delivery': 'Условие поставки:',
        'transport': 'Вид транспорта (Авто):',
        'cols': ['№', 'Наименование товара', 'Код ТН ВЭД', 'Кол-во мест',
                 'Род упаковки', 'Брутто, кг', 'Нетто, кг',
                 'Цена долл.США за 1 кг', 'Сумма долл.США'],
        'total': 'ИТОГО:',
        'seller_foot': 'ПРОДАВЕЦ',
        'released': 'Товар отпустил: __________________ {{ seller_name }}',
        'sign': '(подпись лица)',
    },
    'en': {
        'title': 'INVOICE',
        'number_line': '№ {{ invoice_no }}, {{ invoice_date }}',
        'contract_line': 'Contract № {{ contract_line }}',
        'seller': 'SELLER:',
        'buyer': 'BUYER:',
        'country': 'Country of origin:',
        'loading': 'Place of loading cargo:',
        'delivery': 'Delivery conditions:',
        'transport': 'Type of transport (Auto):',
        'cols': ['№', 'Name of product', 'Code TN FEA', 'Number of pieces',
                 'Type of packing', 'Gross, kg', 'Net, kg',
                 'Price US$ per kg', 'Total US$'],
        'total': 'TOTAL:',
        'seller_foot': 'SELLER',
        'released': 'Goods released by: __________________ {{ seller_name }}',
        'sign': '(signature)',
    },
}


def _set_cell(cell, text, bold=False, size=9):
    cell.text = ''
    run = cell.paragraphs[0].add_run(text)
    run.bold = bold
    run.font.size = Pt(size)


def build(lang: str) -> Path:
    lab = LABELS[lang]
    doc = Document()
    doc.styles['Normal'].font.size = Pt(10)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run(lab['title'])
    r.bold = True
    r.font.size = Pt(14)

    for key in ('number_line', 'contract_line'):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(lab[key]).bold = True

    # Seller / Buyer two-column block
    party = doc.add_table(rows=4, cols=2)
    party.style = 'Table Grid'
    _set_cell(party.rows[0].cells[0], lab['seller'], bold=True)
    _set_cell(party.rows[0].cells[1], lab['buyer'], bold=True)
    _set_cell(party.rows[1].cells[0], '{{ seller_name }}', bold=True, size=10)
    _set_cell(party.rows[1].cells[1], '{{ buyer_name }}', bold=True, size=10)
    _set_cell(party.rows[2].cells[0], '{{ seller_address }}')
    _set_cell(party.rows[2].cells[1], '{{ buyer_address }}')
    _set_cell(party.rows[3].cells[0], '{{ seller_bank }}', size=8)
    _set_cell(party.rows[3].cells[1], '{{ buyer_bank }}', size=8)

    doc.add_paragraph()
    for lab_key, tag in (
        ('country', '{{ country_origin }}'),
        ('loading', '{{ place_loading }}'),
        ('delivery', '{{ delivery_terms }}'),
        ('transport', '{{ transport }}'),
    ):
        p = doc.add_paragraph()
        p.add_run(lab[lab_key] + ' ').bold = True
        p.add_run(tag)

    # Line-items table: header + repeating body row + total row
    cols = lab['cols']
    table = doc.add_table(rows=3, cols=len(cols))
    table.style = 'Table Grid'
    for i, name in enumerate(cols):
        _set_cell(table.rows[0].cells[i], name, bold=True, size=8)

    # Single product line (invoices are one-line in practice). ``line_items`` stays
    # a list so a future multi-row template can switch to a docxtpl row loop.
    body = table.rows[1].cells
    fields = ['n', 'name', 'code', 'pieces', 'packing', 'gross', 'net', 'price', 'total']
    for i, fld in enumerate(fields):
        _set_cell(body[i], f'{{{{ line_items[0].{fld} }}}}', size=9)

    total_cells = table.rows[2].cells
    _set_cell(total_cells[1], lab['total'], bold=True)
    _set_cell(total_cells[len(cols) - 1], '{{ total_sum }}', bold=True)

    doc.add_paragraph('{{ pallet_note }}')
    doc.add_paragraph()
    doc.add_paragraph().add_run(lab['seller_foot']).bold = True
    doc.add_paragraph(lab['released'])
    sign = doc.add_paragraph(lab['sign'])
    sign.alignment = WD_ALIGN_PARAGRAPH.LEFT

    out = OUT_DIR / f'invoice_{lang}.docx'
    doc.save(out)
    return out


# CMR (road consignment note) — simplified labelled layout (NOT the official
# 24-box form). Same Jinja field names the business can re-skin onto the real CMR.
CMR_LABELS = {
    'ru': {
        'title': 'CMR — Международная товарно-транспортная накладная',
        'fields': [
            ('Отправитель (Продавец):', 'sender_name'),
            ('Адрес отправителя:', 'sender_address'),
            ('Получатель (Покупатель):', 'consignee_name'),
            ('Адрес получателя:', 'consignee_address'),
            ('Перевозчик / Экспедитор:', 'forwarder'),
            ('Страна отправления:', 'country_dispatch'),
            ('Место погрузки:', 'place_loading'),
            ('Дата:', 'doc_date'),
            ('Инвойсы:', 'invoice_refs'),
            ('CARNET TIR:', 'tir_carnet'),
            ('Транспорт (авто / водитель):', 'transport'),
        ],
        'cargo': 'Груз:',
        'cols': ['Наименование', 'Кол-во мест', 'Упаковка', 'Поддоны',
                 'Вес поддонов, кг', 'Брутто без подд., кг', 'Брутто с подд., кг', 'Нетто, кг'],
        'cargo_fields': ['cargo_name', 'boxes', 'packing', 'pallets',
                         'pallet_weight', 'gross_without_pallet', 'gross_with_pallet', 'net'],
    },
    'en': {
        'title': 'CMR — International Consignment Note',
        'fields': [
            ('Sender (Seller):', 'sender_name'),
            ('Sender address:', 'sender_address'),
            ('Consignee (Buyer):', 'consignee_name'),
            ('Consignee address:', 'consignee_address'),
            ('Carrier / Forwarder:', 'forwarder'),
            ('Country of dispatch:', 'country_dispatch'),
            ('Place of loading:', 'place_loading'),
            ('Date:', 'doc_date'),
            ('Invoices:', 'invoice_refs'),
            ('CARNET TIR:', 'tir_carnet'),
            ('Transport (vehicle / driver):', 'transport'),
        ],
        'cargo': 'Cargo:',
        'cols': ['Name', 'Pieces', 'Packing', 'Pallets',
                 'Pallet weight, kg', 'Gross w/o pallet, kg', 'Gross w/ pallet, kg', 'Net, kg'],
        'cargo_fields': ['cargo_name', 'boxes', 'packing', 'pallets',
                         'pallet_weight', 'gross_without_pallet', 'gross_with_pallet', 'net'],
    },
}


def build_cmr(lang: str) -> Path:
    lab = CMR_LABELS[lang]
    doc = Document()
    doc.styles['Normal'].font.size = Pt(10)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = title.add_run(lab['title'])
    r.bold = True
    r.font.size = Pt(13)
    doc.add_paragraph()

    info = doc.add_table(rows=len(lab['fields']), cols=2)
    info.style = 'Table Grid'
    for i, (label, field) in enumerate(lab['fields']):
        _set_cell(info.rows[i].cells[0], label, bold=True)
        _set_cell(info.rows[i].cells[1], f'{{{{ {field} }}}}')

    doc.add_paragraph().add_run(lab['cargo']).bold = True
    cols = lab['cols']
    table = doc.add_table(rows=2, cols=len(cols))
    table.style = 'Table Grid'
    for i, name in enumerate(cols):
        _set_cell(table.rows[0].cells[i], name, bold=True, size=8)
    for i, field in enumerate(lab['cargo_fields']):
        _set_cell(table.rows[1].cells[i], f'{{{{ {field} }}}}', size=9)

    out = OUT_DIR / f'cmr_{lang}.docx'
    doc.save(out)
    return out


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
        print(f'wrote {build_cmr(lang)}')
    for key in LETTERS:
        print(f'wrote {build_letter(key)}')


if __name__ == '__main__':
    main()
