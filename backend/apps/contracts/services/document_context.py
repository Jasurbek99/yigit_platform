"""Context builders — assemble the Jinja context dict for each document.

One builder per document family. Builders are PURE: an ORM object in, a plain
dict out — no I/O, no rendering, no file writes — so they unit-test trivially
against fixtures. All FK→display resolution, number/date/locale formatting, and
firm-language selection live here, never in the template or the view.

Date format for these export documents is ``DD.MM.YYYY`` (NOT ISO).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

# Constant: TN VED (HS) code for fresh tomatoes. Overridable per line if needed.
TOMATO_HS_CODE = '070200000'

# Localized data values the builder injects (template labels stay baked into each
# language's .docx; these are *values* that depend on language).
_LOCALE = {
    'ru': {
        'product_name': 'Помидор свежий',
        'packing': 'Ящик',
        'country_origin': 'Туркменистан, урожай {year} года',
        'pallet_note': (
            'Товар уложен на {pallets} деревянных поддонах, общим весом {kg} кг., '
            'не являющимся товаром и предназначены для циркуляции охлаждающего воздуха.'
        ),
    },
    'en': {
        'product_name': 'Fresh tomatoes',
        'packing': 'plastic box',
        'country_origin': 'Turkmenistan, harvest {year} of the year',
        'pallet_note': (
            'The goods are laid on {pallets} wooden pallets, with a total weight of '
            '{kg} kg., which are not goods and are intended for circulating cooling air.'
        ),
    },
}


# Thousands separator for RU number grouping (ASCII space — NBSP/thin-space avoided
# for predictability; visually identical in the rendered document).
_RU_THOUSANDS = ' '


def _localize_number(text: str, lang: str) -> str:
    """Convert an English-grouped number string to the document's locale.

    RU export/customs convention: space-thousands + comma-decimal
    (``7,830.00`` → ``7 830,00``). EN keeps the English form. The two-step swap
    via a placeholder avoids clobbering the separators mid-conversion.
    """
    if lang != 'ru':
        return text
    return text.replace(',', '\x00').replace('.', ',').replace('\x00', _RU_THOUSANDS)


def _money(value: Decimal | None, lang: str = 'ru') -> str:
    """Format a money/total amount as a thousands-grouped 2-dp string, '' if None."""
    if value is None:
        return ''
    return _localize_number(f'{Decimal(value):,.2f}', lang)


def _price(value: Decimal | None, lang: str = 'ru') -> str:
    """Format a per-kg price as a 4-dp string (trailing zeros trimmed), '' if None."""
    if value is None:
        return ''
    text = f'{Decimal(value):,.4f}'.rstrip('0').rstrip('.') or '0'
    return _localize_number(text, lang)


def _kg(value: Decimal | None, lang: str = 'ru') -> str:
    """Format a weight in kg as a thousands-grouped integer-ish string, '' if None."""
    if value is None:
        return ''
    return _localize_number(f'{Decimal(value):,.0f}', lang)


def _date(value: date | None) -> str:
    """Format a date as DD.MM.YYYY, '' if None."""
    if value is None:
        return ''
    return value.strftime('%d.%m.%Y')


def _firm_attr(firm, base: str, lang: str) -> str:
    """Return a tri-lingual ExportFirm attribute (e.g. name/address/bank_details).

    Falls back ru→en→tk so a document never renders an empty firm block just
    because one language column is blank.
    """
    if firm is None:
        return ''
    order = [lang, 'ru', 'en', 'tk']
    for code in order:
        val = getattr(firm, f'{base}_{code}', '') or ''
        if val.strip():
            return val
    return ''


def build_invoice_context(invoice, lang: str = 'ru') -> dict:
    """Build the Jinja context for an invoice document (RU or EN template).

    Pulls weight/transport/packing detail from the linked Shipment when present
    (``invoice.shipment``), and falls back to invoice-level fields otherwise so a
    not-yet-linked invoice still renders a usable document.

    Args:
        invoice: An ``Invoice`` instance. The caller should ``select_related``
            ``contract``, ``shipment``, ``export_firm``, ``import_firm`` for
            N+1 safety; this builder only reads attributes.
        lang: ``'ru'`` or ``'en'`` — selects firm-language columns and localized
            data values. Unknown codes fall back to ``'ru'``.

    Returns:
        A flat dict consumed by ``invoice_ru.docx`` / ``invoice_en.docx``.
    """
    loc = _LOCALE.get(lang, _LOCALE['ru'])
    contract = invoice.contract
    shipment = invoice.shipment

    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)

    # Year for "harvest YYYY" — invoice date drives it.
    year = invoice.invoice_date.year if invoice.invoice_date else ''

    # Net = billed quantity; gross from shipment when linked.
    net_kg = (shipment.weight_net if shipment and shipment.weight_net is not None
              else invoice.quantity_kg)
    gross_kg = shipment.weight_gross if shipment else None
    pieces = shipment.box_count if shipment else None
    pallets = shipment.pallet_count if shipment else None
    pallet_kg = shipment.packaging_kg if shipment else None

    transport = ''
    if shipment:
        plate = (shipment.truck_plate or '').strip()
        trailer = shipment.trailer_id
        transport = f'{plate}/{trailer}' if plate and trailer else plate or ''

    incoterm = (invoice.incoterm or (contract.incoterm if contract else '') or '').strip()

    pallet_note = ''
    if pallets:
        pallet_note = loc['pallet_note'].format(
            pallets=pallets, kg=_kg(pallet_kg, lang) or '0',
        )

    line_item = {
        'n': '1',
        'name': loc['product_name'],
        'code': TOMATO_HS_CODE,
        'pieces': str(pieces) if pieces else '',
        'packing': loc['packing'],
        'gross': _kg(gross_kg, lang),
        'net': _kg(net_kg, lang),
        'price': _price(invoice.price_per_kg, lang),
        'total': _money(invoice.total_usd, lang),
    }

    return {
        'invoice_no': str(invoice.invoice_number),
        'invoice_date': _date(invoice.invoice_date),
        'contract_line': _contract_line(contract),
        'seller_name': _firm_attr(seller, 'name', lang),
        'seller_address': _firm_attr(seller, 'address', lang),
        'seller_bank': _firm_attr(seller, 'bank_details', lang),
        'buyer_name': getattr(buyer, 'name_company', '') or '',
        'buyer_address': getattr(buyer, 'address', '') or '',
        'buyer_bank': getattr(buyer, 'bank_details', '') or '',
        'country_origin': loc['country_origin'].format(year=year) if year else '',
        'place_loading': '',  # populated once a loading-location source is wired
        'delivery_terms': incoterm,
        'transport': transport,
        'line_items': [line_item],
        'total_sum': _money(invoice.total_usd, lang),
        'pallet_note': pallet_note,
    }


def invoice_filename_fields(invoice) -> dict:
    """Flat dict for the registry ``out_pattern`` (download filename)."""
    return {
        'contract_number': (invoice.contract.contract_number if invoice.contract else 'NA')
        .replace('/', '-'),
        'invoice_number': invoice.invoice_number,
    }


# ─── CMR (road consignment note) ─────────────────────────────────────────────

_CMR_LOCALE = {
    'ru': {
        'cargo_name': 'Помидоры свежие',
        'packing': 'ящик',
        'country_dispatch': 'Туркменистан',
        'invoice_ref': 'Инвойс № {num}, {date}',
    },
    'en': {
        'cargo_name': 'FRESH TOMATOES',
        'packing': 'plastic boxes',
        'country_dispatch': 'Turkmenistan',
        'invoice_ref': 'Invoice № {num}, {date}',
    },
}


def build_cmr_context(invoice, lang: str = 'ru') -> dict:
    """Build the Jinja context for a CMR (road consignment note), single-firm.

    A CMR is a per-truck transport document; one Invoice == one truck dispatched,
    so the invoice is the per-truck unit and ``invoice.shipment`` supplies the
    transport/cargo detail. When the shipment link is absent (Slice B not yet
    wired) those fields render blank — the document still produces.

    **Deliberate v1 scope:** single seller only. The 2-/3-seller firm-split CMRs
    (which aggregate multiple invoices onto one truck) and the official 24-box CMR
    layout are follow-on registry entries; route/border/loading-place/TIR fields
    are blank until those sources are mapped.

    Args:
        invoice: An ``Invoice`` instance (caller should ``select_related``
            ``contract``/``shipment``/firms).
        lang: ``'ru'`` or ``'en'``.

    Returns:
        Flat dict consumed by ``cmr_ru.docx`` / ``cmr_en.docx``.
    """
    loc = _CMR_LOCALE.get(lang, _CMR_LOCALE['ru'])
    contract = invoice.contract
    shipment = invoice.shipment

    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)

    net_kg = (shipment.weight_net if shipment and shipment.weight_net is not None
              else invoice.quantity_kg)
    gross_wo = shipment.weight_gross if shipment else None
    pallet_w = None
    if shipment:
        pallet_w = shipment.pallet_weight_kg or shipment.packaging_kg
    gross_with = (gross_wo + pallet_w) if (gross_wo is not None and pallet_w is not None) else None

    transport = ''
    if shipment:
        plate = (shipment.truck_plate or '').strip()
        trailer = shipment.trailer_id
        driver = (shipment.driver_name or '').strip()
        veh = f'{plate}/{trailer}' if plate and trailer else plate or ''
        transport = ' — '.join(p for p in (veh, driver) if p)

    invoice_refs = loc['invoice_ref'].format(
        num=invoice.invoice_number, date=_date(invoice.invoice_date),
    )

    return {
        'carrier': getattr(buyer, 'name_company', '') or '',
        'sender_name': _firm_attr(seller, 'name', lang),
        'sender_address': _firm_attr(seller, 'address', lang),
        'consignee_name': getattr(buyer, 'name_company', '') or '',
        'consignee_address': getattr(buyer, 'address', '') or '',
        'country_dispatch': loc['country_dispatch'],
        'place_loading': '',   # pending loading-location source
        'forwarder': '',       # not modeled yet
        'route': '',           # pending border/route source
        'doc_date': _date(invoice.invoice_date),
        'invoice_refs': invoice_refs,
        'tir_carnet': '',      # not modeled on shipment yet
        'cargo_name': loc['cargo_name'],
        'boxes': str(shipment.box_count) if shipment and shipment.box_count else '',
        'packing': loc['packing'],
        'pallets': str(shipment.pallet_count) if shipment and shipment.pallet_count else '',
        'pallet_weight': _kg(pallet_w, lang),
        'gross_without_pallet': _kg(gross_wo, lang),
        'gross_with_pallet': _kg(gross_with, lang),
        'net': _kg(net_kg, lang),
        'transport': transport,
    }


# ─── Authority request letters (CT-1, phyto, customs) ────────────────────────

def _contract_line(contract) -> str:
    """``<number>, <DD.MM.YYYY>`` for a contract, '' if none."""
    if not contract:
        return ''
    parts = [contract.contract_number]
    if contract.start_date:
        parts.append(_date(contract.start_date))
    return ', '.join(parts)


def _country_name(invoice, lang: str) -> str:
    """Destination country name for the document language.

    Prefers the shipment's country, falling back to the buyer firm's country.
    Reads a nested FK (one extra query) — fine for single-document generation.
    """
    for src in (invoice.shipment, invoice.import_firm,
                invoice.contract.import_firm if invoice.contract else None):
        country = getattr(src, 'country', None)
        if country is not None:
            return (getattr(country, f'name_{lang}', '')
                    or getattr(country, 'name_ru', '') or '')
    return ''


def build_ct1_context(invoice, lang: str = 'ru') -> dict:
    """CT-1 certificate-of-origin request letter (RU). Needs only firm + contract."""
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    return {
        'firm_name': _firm_attr(seller, 'name', lang),
        'product': 'Свежие Помидоры',
        'contract_line': _contract_line(contract),
        'doc_date': _date(invoice.invoice_date),
    }


def build_fito_context(invoice, lang: str = 'ru') -> dict:
    """Phytosanitary-certificate request letter (RU). Firm, destination, weight, boxes."""
    contract = invoice.contract
    shipment = invoice.shipment
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    net_kg = (shipment.weight_net if shipment and shipment.weight_net is not None
              else invoice.quantity_kg)
    boxes = shipment.box_count if shipment else None
    return {
        'firm_name': _firm_attr(seller, 'name', lang),
        'country': _country_name(invoice, lang),
        'product': 'Свежих Помидоров',
        'net': _kg(net_kg, lang),
        'boxes': str(boxes) if boxes else '',
        'doc_date': _date(invoice.invoice_date),
    }


def build_customs_context(invoice, lang: str = 'tk') -> dict:
    """Customs-clearance request letter (ARZA, Turkmen). Seller, buyer, contract, dest."""
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)
    return {
        'seller_name': _firm_attr(seller, 'name', lang),
        'buyer_name': getattr(buyer, 'name_company', '') or '',
        'contract_line': _contract_line(contract),
        'country': _country_name(invoice, lang),
        'doc_date': _date(invoice.invoice_date),
    }
