"""Context builders — assemble the Jinja context dict for each document.

One builder per document family. Builders are PURE: an ORM object in, a plain
dict out — no I/O, no rendering, no file writes — so they unit-test trivially
against fixtures. All FK→display resolution, number/date/locale formatting, and
firm-language selection live here, never in the template or the view.

Date format for these export documents is ``DD.MM.YYYY`` (NOT ISO).
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from apps.contracts.services.amount_words import amount_words_ru, amount_words_tk

# Constant: TN VED (HS) code for fresh tomatoes. Overridable per line if needed.
TOMATO_HS_CODE = '070200000'

# The shipment's whole-truck packing cells that MUST be filled in the Sheet before
# any document generates (gross + net + boxes + pallets). ``box_count`` /
# ``pallet_count`` may legitimately be 0? no — a truck always carries boxes on
# pallets, so ``None`` (unfilled) is the only invalid state; ``is None`` is the test.
REQUIRED_PACKING_FIELDS = ('weight_gross', 'weight_net', 'box_count', 'pallet_count')

# Each required shipment cell → its PackingTemplate counterpart. Packing counts as
# filled when EITHER the raw cell OR the applied template supplies it — mirroring
# build_cmr_context's fallback, so a truck configured via a PackingTemplate (which
# links the template + per-firm sales but leaves the raw cells null) is not blocked.
_PACKING_TEMPLATE_FIELD = {
    'weight_gross': 'gross_kg',
    'weight_net': 'net_kg',
    'box_count': 'box_count',
    'pallet_count': 'pallet_count',
}

# Shared 400 message when the packing guard blocks generation.
PACKING_REQUIRED_MESSAGE = (
    'Packing (gross, net, boxes, pallets) must be filled in the Sheet before '
    'generating documents.'
)


def missing_packing_on(shipment) -> list[str]:
    """Return the packing fields still unresolved on a shipment (empty ⇒ complete).

    Documents require the whole-truck packing (gross / net / boxes / pallets). A
    field is satisfied by the raw shipment cell or by an applied PackingTemplate;
    the returned list is the fields neither source provides. No shipment ⇒ every
    field counts as missing.
    """
    if shipment is None:
        return list(REQUIRED_PACKING_FIELDS)
    preset = getattr(shipment, 'packing_template', None)
    missing = []
    for field, template_field in _PACKING_TEMPLATE_FIELD.items():
        if getattr(shipment, field) is not None:
            continue
        if preset is not None and getattr(preset, template_field) is not None:
            continue
        missing.append(field)
    return missing


def missing_packing_fields(invoice) -> list[str]:
    """``missing_packing_on`` for an invoice's linked shipment (firm-doc guard)."""
    return missing_packing_on(invoice.shipment)

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


def _num(value) -> str:
    """Format a count that may be fractional, dropping a trailing ``.0``.

    Pallet counts are ``33`` for a full truck but ``16.5`` for a 2-firm share, so
    the value is a Decimal — render ``33`` not ``33.0``, keep ``16.5``.
    """
    if value is None:
        return ''
    d = Decimal(str(value))
    d = d.quantize(Decimal('1')) if d == d.to_integral_value() else d.normalize()
    return f'{d}'


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


def build_invoice_context(invoice, lang: str = 'ru', overrides: dict | None = None) -> dict:
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
    overrides = overrides or {}
    loc = _LOCALE.get(lang, _LOCALE['ru'])
    contract = invoice.contract
    shipment = invoice.shipment

    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)

    # Year for "harvest YYYY" — invoice date drives it.
    year = invoice.invoice_date.year if invoice.invoice_date else ''

    # Per-firm packing = the EXPLICIT values on this firm's ContractSale (copied
    # from the applied PackingTemplate's share, then editable per truck). NET is the
    # firm's OFFICIAL weight (quantity_kg) — never the real shipment.weight_net
    # (ADR-023). Gross/pieces/pallets fall back to the whole-truck shipment fields
    # only when the sale has no packing set.
    net_kg = invoice.quantity_kg
    gross_kg = (invoice.gross_kg if invoice.gross_kg is not None
                else (shipment.weight_gross if shipment else None))
    pieces = (invoice.box_count if invoice.box_count is not None
              else (shipment.box_count if shipment else None))
    pallets = (invoice.pallet_count if invoice.pallet_count is not None
               else (shipment.pallet_count if shipment else None))
    pallet_kg = (invoice.pallet_weight_kg if invoice.pallet_weight_kg is not None
                 else ((shipment.pallet_weight_kg or shipment.packaging_kg) if shipment else None))

    transport = ''
    if shipment:
        plate = (shipment.truck_plate or '').strip()
        trailer = shipment.trailer_id
        transport = f'{plate}/{trailer}' if plate and trailer else plate or ''

    incoterm = (invoice.incoterm or (contract.incoterm if contract else '') or '').strip()

    pallet_note = ''
    if pallets:
        pallet_note = loc['pallet_note'].format(
            pallets=_num(pallets), kg=_kg(pallet_kg, lang) or '0',
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
        'place_loading': overrides.get('place_loading', ''),  # picked at generate-time
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


def build_cmr_context(shipment, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Build the Jinja context for a CMR (road consignment note), truck-level.

    A CMR is a per-**truck** transport document: one Shipment == one truck, which
    may carry 1–3 export firms (``firm_splits``) selling to a single buyer
    (``shipment.import_firm``). All firms are listed as senders; cargo/weights are
    the whole-truck figures. Invoice refs aggregate every invoice on the truck.

    The packing guard (``missing_packing_on``) ensures the whole-truck packing is
    resolvable before this runs — from the raw shipment cells or an applied
    ``PackingTemplate`` (which overrides the raw fields when present). The
    forwarder is the export firm(s); ``place_loading`` and ``tir_carnet`` are
    supplied at generate-time via ``overrides`` (blank when not provided).

    **Deliberate scope:** the official 24-box CMR layout is a follow-on; this uses
    the simplified labelled template with the sellers joined into the sender box.

    Args:
        shipment: A ``Shipment`` instance (caller should ``prefetch_related``
            ``firm_splits__export_firm`` / ``sales`` and ``select_related``
            ``import_firm`` / ``packing_template``).
        lang: ``'ru'`` or ``'en'``.

    Returns:
        Flat dict consumed by ``cmr_ru.docx`` / ``cmr_en.docx``.
    """
    overrides = overrides or {}
    loc = _CMR_LOCALE.get(lang, _CMR_LOCALE['ru'])

    # Sellers: every export firm on the truck (1–3 firm splits), joined into the
    # single sender box (the simplified template has no per-consignor rows). Joined
    # with '; ' — a bare '\n' does NOT render as a line break in a docx run.
    firms = [split.export_firm for split in shipment.firm_splits.all()]
    sender_name = '; '.join(_firm_attr(firm, 'name', lang) for firm in firms)
    sender_address = '; '.join(
        addr for addr in (_firm_attr(firm, 'address', lang) for firm in firms) if addr
    )
    buyer = shipment.import_firm

    # Whole-truck packing. BRUT = gross WITH pallets, so "without" is the
    # subtraction. A PackingTemplate on the shipment overrides the raw fields.
    # Each dimension resolves independently (preset field, else raw cell) — the
    # SAME per-field fallback missing_packing_on() checks, so a truck the guard
    # passes never renders a blank cell here.
    preset = shipment.packing_template
    boxes = preset.box_count if preset and preset.box_count is not None else shipment.box_count
    pallets = preset.pallet_count if preset and preset.pallet_count is not None else shipment.pallet_count
    net_kg = preset.net_kg if preset and preset.net_kg is not None else shipment.weight_net
    if preset and preset.gross_kg is not None:
        pallet_w = preset.pallet_weight_kg
        gross_with = preset.gross_kg
    else:
        pallet_w = shipment.pallet_weight_kg or shipment.packaging_kg
        gross_with = shipment.weight_gross
    gross_wo = ((gross_with - pallet_w) if (gross_with is not None and pallet_w is not None)
                else gross_with)

    plate = (shipment.truck_plate or '').strip()
    trailer = shipment.trailer_id
    driver = (shipment.driver_name or '').strip()
    veh = f'{plate}/{trailer}' if plate and trailer else plate or ''
    transport = ' — '.join(part for part in (veh, driver) if part)

    # Invoice refs: every numbered invoice on the truck (one per firm). Bridge
    # sales may still have a NULL invoice_number — skip them, don't print "None".
    sales = list(shipment.sales.all())
    numbers = ', '.join(
        str(sale.invoice_number) for sale in sales if sale.invoice_number is not None
    )
    ref_date = _date(sales[0].invoice_date) if sales and sales[0].invoice_date else _date(shipment.date)
    invoice_refs = loc['invoice_ref'].format(num=numbers, date=ref_date) if numbers else ''

    return {
        'carrier': getattr(buyer, 'name_company', '') or '',
        'sender_name': sender_name,
        'sender_address': sender_address,
        'consignee_name': getattr(buyer, 'name_company', '') or '',
        'consignee_address': getattr(buyer, 'address', '') or '',
        'country_dispatch': loc['country_dispatch'],
        'place_loading': overrides.get('place_loading', ''),  # picked at generate-time
        'forwarder': sender_name,  # the export firm(s) act as forwarder
        'doc_date': _date(shipment.date),
        'invoice_refs': invoice_refs,
        'tir_carnet': overrides.get('tir_carnet', ''),  # typed at generate-time (Uzbekistan transit)
        'cargo_name': loc['cargo_name'],
        'boxes': str(boxes) if boxes else '',
        'packing': loc['packing'],
        'pallets': _num(pallets) if pallets else '',
        'pallet_weight': _kg(pallet_w, lang),
        'gross_without_pallet': _kg(gross_wo, lang),
        'gross_with_pallet': _kg(gross_with, lang),
        'net': _kg(net_kg, lang),
        'transport': transport,
    }


def cmr_filename_fields(shipment) -> dict:
    """Flat dict for the CMR registry ``out_pattern`` (download filename)."""
    return {'shipment_code': (shipment.shipment_code or 'NA').replace('/', '-')}


# ─── CMR overlay (xlsx print-overlay onto the pre-printed official form) ──────
#
# The CMR is NOT a self-contained document: the office prints truck data ON TOP of
# the pre-printed 24-box CMR form, using the ``CMR RU`` / ``CMR EN`` sheets whose
# geometry (A4 @ 60% scale, column/row sizes) is tuned to register on the paper.
# So instead of a docx layout we fill the cleaned template sheet (see
# ``document_templates/build_cmr_xlsx.py``) by coordinate. This builder returns a
# ``{cell_coordinate: value}`` map consumed by ``document_render.render_xlsx``.

# Combined-phrase locale for the overlay (values the sheet baked into one cell).
_CMR_OVERLAY_LOCALE = {
    'ru': {'pallets_line': 'на {n} деревянных поддонах', 'net_suffix': ' кг.',
           'tir_prefix': 'CARNET TIR '},
    'en': {'pallets_line': 'on {n} wooden pallets', 'net_suffix': ' kg.',
           'tir_prefix': 'CARNET TIR '},
}

# Per-language cell coordinate → overlay-value key. RU and EN diverge because the
# two source sheets sit the same data on slightly different rows/columns.
_CMR_OVERLAY_CELLS = {
    'ru': {
        'E2': 'sender_name', 'B3': 'sender_address',
        'B8': 'consignee_name', 'B9': 'consignee_address', 'B15': 'country_destination',
        'D18': 'place_loading', 'D19': 'country_dispatch', 'C20': 'doc_date',
        'D22': 'invoice_refs', 'D23': 'tir_line',
        'G26': 'cargo_name', 'D27': 'boxes', 'E27': 'packing', 'D28': 'pallets_line',
        'L27': 'pallet_weight', 'L28': 'gross_without_pallet', 'L29': 'gross_with_pallet',
        'N29': 'net_line', 'G46': 'doc_date', 'G48': 'driver_name', 'F53': 'plates',
    },
    'en': {
        'E2': 'sender_name', 'B3': 'sender_address',
        'B8': 'consignee_name', 'B9': 'consignee_address', 'C15': 'country_destination',
        'D17': 'place_loading', 'D18': 'country_dispatch', 'D19': 'doc_date',
        'D22': 'invoice_refs', 'D23': 'tir_line',
        'G26': 'cargo_name', 'D27': 'boxes', 'E27': 'packing', 'D28': 'pallets_line',
        'L27': 'pallet_weight', 'L28': 'gross_without_pallet', 'L29': 'gross_with_pallet',
        'N29': 'net_line', 'G46': 'doc_date', 'F48': 'driver_name', 'F54': 'plates',
    },
}


def _dest_country_name(shipment, lang: str) -> str:
    """Destination country name (box 3 of the CMR), '' if unresolved."""
    country = getattr(getattr(shipment, 'import_firm', None), 'country', None)
    if country is None:
        return ''
    return getattr(country, f'name_{lang}', '') or getattr(country, 'name_ru', '') or ''


def build_cmr_overlay(shipment, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Build the ``{cell: value}`` map for the CMR xlsx overlay.

    Reuses ``build_cmr_context`` for the formatted truck figures, then places them
    (plus the destination country, driver, and plates) at the sheet coordinates the
    pre-printed form expects. Empty values are dropped so the template's fixed
    labels aren't overwritten with blanks.

    Args:
        shipment: A ``Shipment`` (same prefetch expectations as ``build_cmr_context``).
        lang: ``'ru'`` or ``'en'`` — selects the coordinate map + phrase locale.

    Returns:
        ``{cell_coordinate: str}`` for the language's template sheet.
    """
    lang = lang if lang in _CMR_OVERLAY_CELLS else 'ru'
    phrases = _CMR_OVERLAY_LOCALE[lang]
    ctx = build_cmr_context(shipment, lang, overrides)

    plate = (shipment.truck_plate or '').strip()
    trailer = shipment.trailer_id
    plates = f'{plate}/{trailer}' if plate and trailer else plate or ''
    pallets = ctx['pallets']

    values = {
        'sender_name': ctx['sender_name'],
        'sender_address': ctx['sender_address'],
        'consignee_name': ctx['consignee_name'],
        'consignee_address': ctx['consignee_address'],
        'country_destination': _dest_country_name(shipment, lang),
        'place_loading': ctx['place_loading'],
        'country_dispatch': ctx['country_dispatch'],
        'doc_date': ctx['doc_date'],
        'invoice_refs': ctx['invoice_refs'],
        'tir_line': f"{phrases['tir_prefix']}{ctx['tir_carnet']}" if ctx['tir_carnet'] else '',
        'cargo_name': ctx['cargo_name'],
        'boxes': ctx['boxes'],
        'packing': ctx['packing'],
        'pallets_line': phrases['pallets_line'].format(n=pallets) if pallets else '',
        'pallet_weight': ctx['pallet_weight'],
        'gross_without_pallet': ctx['gross_without_pallet'],
        'gross_with_pallet': ctx['gross_with_pallet'],
        'net_line': f"{ctx['net']}{phrases['net_suffix']}" if ctx['net'] else '',
        'driver_name': (shipment.driver_name or '').strip(),
        'plates': plates,
    }
    cells = {coord: values[key] for coord, key in _CMR_OVERLAY_CELLS[lang].items()}
    return {coord: val for coord, val in cells.items() if val not in (None, '')}


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


def build_ct1_context(invoice, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """CT-1 certificate-of-origin request letter (RU). Needs only firm + contract.

    ``overrides`` is accepted for a uniform builder signature but unused here.
    """
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    return {
        'firm_name': _firm_attr(seller, 'name', lang),
        'product': 'Свежие Помидоры',
        'contract_line': _contract_line(contract),
        'doc_date': _date(invoice.invoice_date),
    }


def build_fito_context(invoice, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Phytosanitary-certificate request letter (RU). Firm, destination, weight, boxes.

    ``overrides`` is accepted for a uniform builder signature but unused here.
    """
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


def build_customs_context(invoice, lang: str = 'tk', overrides: dict | None = None) -> dict:
    """Customs-clearance request letter (ARZA, Turkmen). Seller, buyer, contract, dest.

    ``overrides`` is accepted for a uniform builder signature but unused here.
    """
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


# ─── Export contract (bilingual TK/RU agreement) ─────────────────────────────

# Russian genitive month names for spelled dates ("30 июня 2026").
_RU_MONTHS_GEN = [
    '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]


def _date_ru_spelled(value: date | None) -> str:
    """Spelled Russian date without the trailing 'года' ('30 июня 2026'), '' if None.

    The template supplies the fixed 'года'/'г.' suffix, so this returns just
    ``<day> <month-genitive> <year>``.
    """
    if value is None:
        return ''
    return f'{value.day} {_RU_MONTHS_GEN[value.month]} {value.year}'


def _date_tk_numeric(value: date | None) -> str:
    """Turkmen date as ``DD.MM.YYYY ý.``, '' if None.

    Turkmen spelled-out ordinal dates need vowel-harmony morphology that the
    source contracts apply inconsistently, so we use the unambiguous numeric
    form (idiomatic in Turkmen official text) rather than risk wrong grammar.
    """
    if value is None:
        return ''
    return f'{value:%d.%m.%Y} ý.'


def _oneline(text: str) -> str:
    """Collapse line breaks in a blob to '; ' (docx runs don't render '\\n')."""
    return '; '.join(part.strip() for part in text.splitlines() if part.strip())


def _parse_iso(value: str | None) -> date | None:
    """Parse a ``YYYY-MM-DD`` string (from a query param) to a date, None if invalid."""
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


# Legal-form suffix the template already supplies as a fixed word around the seller
# name placeholder (e.g. ``«{{ seller_name_tk }}» HJ``), stripped from the stored
# firm name so the form isn't printed twice ("Hemsaya H.J." → "Hemsaya"). Matches on
# a whitespace separator only — it never consumes quote marks, so a name stored with
# guillemets keeps both of them ("«X» H.J." → "«X»", not "«X").
_SELLER_FORM_SUFFIX = re.compile(r'\s+(H\.?\s?J\.?|Х\.?\s?Дж\.?)\.?\s*$', re.IGNORECASE)
# Director title the template already labels ("Direktor {{ seller_director }}"),
# stripped from the stored value ("Директор Маммедов А.А." → "Маммедов А.А.").
_DIRECTOR_TITLE = re.compile(r'^\s*(Директор|Direktor|Director)\s+', re.IGNORECASE)


def _bare_seller_name(name: str) -> str:
    """Strip a trailing legal-form suffix so it isn't duplicated by the template.

    Falls back to the original name if stripping would empty it (a name that is
    *only* a legal form, e.g. literally "H.J." — degenerate data, but never render
    an empty "«»").
    """
    stripped = _SELLER_FORM_SUFFIX.sub('', name or '').strip()
    return stripped or (name or '').strip()


def _seller_director(firm) -> str:
    """Director name without the leading title word the template already prints.

    Single value (ExportFirm stores one ``director`` column, not a tk/ru split), so a
    Cyrillic-stored name prints in the Turkmen column too — accepted, since it is a
    proper name. Add ``director_tk``/``director_ru`` to ExportFirm for a script split.
    """
    return _DIRECTOR_TITLE.sub('', getattr(firm, 'director', '') or '').strip()


def build_contract_context(contract, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Build the Jinja context for the bilingual TK/RU export contract.

    The contract .docx is a two-column legal instrument (a single template holds
    both languages, unlike the per-language invoice/CMR).

    - **Financials / dates / validity** come from the ``Contract``.
    - **Seller** = ``contract.export_firm``: bilingual name (bare, the template
      supplies the legal form) / address / director, and its ``bank_details_*``
      blob collapsed to one line (the template's structured seller-bank lines were
      merged, since ExportFirm stores only a blob).
    - **Buyer** = ``contract.import_firm``: the structured bilingual requisites
      (name/address/director/бИН/БИК/р-с/bank-name), each falling back to the flat
      ``name_company`` / ``address`` field when its language-specific column is
      blank, plus the bilingual country name. ``buyer_director`` may also be passed
      as an override for firms whose ``director_*`` columns aren't filled yet.
    - **``delivery_deadline``** (§2.6) is generate-time (``YYYY-MM-DD`` override);
      the validity date (§8.1) is ``Contract.end_date``.

    Args:
        contract: A ``Contract`` instance. Caller should ``select_related``
            ``export_firm``, ``import_firm__country``.
        lang: Accepted for a uniform builder signature; the template is bilingual
            so both language values are always emitted.
        overrides: ``buyer_director`` and ``delivery_deadline`` from the request.

    Returns:
        Flat dict consumed by ``contract_kz.docx``.
    """
    overrides = overrides or {}
    seller = contract.export_firm
    buyer = contract.import_firm
    country = getattr(buyer, 'country', None)

    amount = contract.planned_amount_usd
    qty = contract.planned_quantity_kg
    unit_price = (amount / qty) if (amount and qty) else None
    # The figure (total_sum) is 2dp; the spelled-out amount is whole-dollar only —
    # matching the source contract convention ("7 830,00 (ýedi müň … otuz)"). These
    # planned totals are always round dollars, so figure and words agree; a
    # fractional planned_amount_usd would spell only the whole part (cents not voiced).
    whole_dollars = int(amount) if amount is not None else None

    deadline = _parse_iso(overrides.get('delivery_deadline'))
    override_director = (overrides.get('buyer_director') or '').strip()

    # Buyer: structured column, falling back to the flat blob field when blank so a
    # firm that only has the legacy name_company/address still renders something.
    flat_name = getattr(buyer, 'name_company', '') or getattr(buyer, 'name_short', '') or ''
    flat_address = getattr(buyer, 'address', '') or ''

    def _buyer(field: str, fallback: str = '') -> str:
        return (getattr(buyer, field, '') or '').strip() or fallback

    return {
        'contract_no': contract.contract_number or '',
        'contract_date': _date(contract.start_date),
        # Financials — one numeric value shown in both language columns (RU grouping).
        'total_sum': _money(amount, 'ru'),
        'total_sum_words_tk': amount_words_tk(whole_dollars) if whole_dollars is not None else '',
        'total_sum_words_ru': amount_words_ru(whole_dollars) if whole_dollars is not None else '',
        'quantity': _kg(qty, 'ru'),
        'price': _price(unit_price, 'ru'),
        # Dates — RU spelled, TK numeric (see _date_tk_numeric).
        'delivery_deadline_tk': _date_tk_numeric(deadline),
        'delivery_deadline_ru': _date_ru_spelled(deadline),
        'validity_tk': _date_tk_numeric(contract.end_date),
        'validity_ru': _date_ru_spelled(contract.end_date),
        # Seller (export firm) — name bare (template supplies the legal form).
        'seller_name_tk': _bare_seller_name(getattr(seller, 'name_tk', '') or ''),
        'seller_name_ru': _bare_seller_name(
            getattr(seller, 'name_ru', '') or getattr(seller, 'name_tk', '') or ''
        ),
        'seller_address_tk': getattr(seller, 'address_tk', '') or '',
        'seller_address_ru': getattr(seller, 'address_ru', '') or getattr(seller, 'address_tk', '') or '',
        'seller_director': _seller_director(seller),
        'seller_bank_tk': _oneline(getattr(seller, 'bank_details_tk', '') or ''),
        'seller_bank_ru': _oneline(
            getattr(seller, 'bank_details_ru', '') or getattr(seller, 'bank_details_tk', '') or ''
        ),
        # Buyer (import firm) — structured bilingual requisites with flat fallback.
        'buyer_name_tk': _buyer('name_tk', flat_name),
        'buyer_name_ru': _buyer('name_ru', flat_name),
        'buyer_country_tk': getattr(country, 'name_tk', '') or '',
        'buyer_country_ru': getattr(country, 'name_ru', '') or getattr(country, 'name_tk', '') or '',
        'buyer_director_tk': _buyer('director_tk', override_director),
        'buyer_director_ru': _buyer('director_ru', override_director),
        'buyer_address_tk': _buyer('address_tk', flat_address),
        'buyer_address_ru': _buyer('address_ru', flat_address),
        'buyer_bin': _buyer('bank_bin'),
        'buyer_bik': _buyer('bank_bik'),
        'buyer_account': _buyer('bank_account'),
        'buyer_bank_name_tk': _buyer('bank_name_tk'),
        'buyer_bank_name_ru': _buyer('bank_name_ru'),
    }


def contract_filename_fields(contract) -> dict:
    """Flat dict for the contract registry ``out_pattern`` (download filename)."""
    return {'contract_number': (contract.contract_number or 'NA').replace('/', '-')}
