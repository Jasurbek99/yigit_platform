"""Context builders — assemble the Jinja context dict for each document.

One builder per document family. Builders are PURE: an ORM object in, a plain
dict out — no I/O, no rendering, no file writes — so they unit-test trivially
against fixtures. All FK→display resolution, number/date/locale formatting, and
firm-language selection live here, never in the template or the view.

Date format for these export documents is ``DD.MM.YYYY`` (NOT ISO).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import NamedTuple

from apps.contracts.services.amount_words import amount_words_ru, amount_words_tk


@dataclass(frozen=True)
class StampImage:
    """A deferred image (a Django FieldFile) for a signature-block stamp.

    Builders stay I/O-free: they emit this marker referencing the firm's seal /
    signature FileField, and ``document_render.render_docx`` turns it into a
    docxtpl ``InlineImage`` at render time (where the DocxTemplate exists). An
    empty context value (``''``) renders nothing — used when stamps are off or
    the firm has no image uploaded.
    """

    file: object          # a Django FieldFile, or None
    width_mm: float = 32.0


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


def _truck_plate(shipment) -> str:
    """``'{tractor}/{trailer}'`` for a shipment ('' if no shipment/plate).

    Single source of truth for how a truck's registration prints — the invoice,
    CMR context, CMR overlay, and the request letters all read it, so the
    separator / empty-trailer handling stays identical across every document.
    """
    if shipment is None:
        return ''
    plate = (shipment.truck_plate or '').strip()
    trailer = shipment.trailer_id
    return f'{plate}/{trailer}' if plate and trailer else plate or ''


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

    transport = _truck_plate(shipment)

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
        # invoice_number is nullable — a bridge sale (or one not yet numbered)
        # has NULL; render blank, never the literal "None". See ContractSale.
        'invoice_no': str(invoice.invoice_number) if invoice.invoice_number is not None else '',
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
        # NULL invoice_number would otherwise land as "None" in the filename.
        'invoice_number': invoice.invoice_number if invoice.invoice_number is not None else 'NA',
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

    The sellers are joined into the single sender box (the pre-printed 24-box form
    has one consignor slot).

    Args:
        shipment: A ``Shipment`` instance (caller should ``prefetch_related``
            ``firm_splits__export_firm`` / ``sales`` and ``select_related``
            ``import_firm`` / ``packing_template``).
        lang: ``'ru'`` or ``'en'``.

    Returns:
        Flat dict of formatted figures. NOT rendered directly — ``build_cmr_overlay``
        maps it to a ``{cell: value}`` overlay for ``cmr_ru.xlsx`` / ``cmr_en.xlsx``.
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

    driver = (shipment.driver_name or '').strip()
    veh = _truck_plate(shipment)
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


def build_cmr_overlay_values(shipment, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """The CMR overlay's field values keyed by NAME (not cell coordinate).

    Single source of truth for what the overlay prints, shared by both output
    formats: ``build_cmr_overlay`` maps these onto the xlsx sheet's coordinates,
    while the Word variant consumes them directly as a Jinja context (its template
    already has each ``{{ name }}`` positioned in the matching grid cell). Keeping
    one values function means the two formats can never drift apart.

    Args:
        shipment: A ``Shipment`` (same prefetch expectations as ``build_cmr_context``).
        lang: ``'ru'`` or ``'en'`` — selects the phrase locale.

    Returns:
        ``{field_name: str}`` — the same keys the coordinate map references.
    """
    lang = lang if lang in _CMR_OVERLAY_CELLS else 'ru'
    phrases = _CMR_OVERLAY_LOCALE[lang]
    ctx = build_cmr_context(shipment, lang, overrides)

    plates = _truck_plate(shipment)
    pallets = ctx['pallets']

    # Per-firm sender slots. The office CMR form has TWO consignor blocks (a truck
    # may carry 1–3 export firms), so expose them individually as well as joined:
    # the Word template fills sender1/sender2 separately, matching the paper form.
    # A 3rd firm (rare) is appended to slot 2 so it is never silently dropped.
    firms = [split.export_firm for split in shipment.firm_splits.all()]
    names = [_firm_attr(firm, 'name', lang) for firm in firms]
    addresses = [_firm_attr(firm, 'address', lang) for firm in firms]

    return {
        'sender_name': ctx['sender_name'],
        'sender_address': ctx['sender_address'],
        'sender1_name': names[0] if names else '',
        'sender1_address': addresses[0] if addresses else '',
        'sender2_name': '; '.join(n for n in names[1:] if n),
        'sender2_address': '; '.join(a for a in addresses[1:] if a),
        # Not stored on Shipment (no passport / vehicle-model columns) — rendered
        # blank so the crew can complete them by hand on the printed form.
        'driver_passport': '',
        'truck_model': '',
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


def build_cmr_overlay(shipment, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Build the ``{cell: value}`` map for the CMR **xlsx** overlay.

    Places ``build_cmr_overlay_values`` onto the sheet coordinates the pre-printed
    form expects. Empty values are dropped so the template's fixed labels aren't
    overwritten with blanks.

    Returns:
        ``{cell_coordinate: str}`` for the language's template sheet.
    """
    lang = lang if lang in _CMR_OVERLAY_CELLS else 'ru'
    values = build_cmr_overlay_values(shipment, lang, overrides)
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


class LetterFigures(NamedTuple):
    """Per-firm cargo figures shared by the request letters (attribute access so
    call sites never depend on tuple ordering)."""

    net: Decimal | None
    gross: Decimal | None
    boxes: int | None
    plate: str


def _letter_figures(invoice) -> LetterFigures:
    """Per-firm net/gross/boxes/plate for the request letters.

    Net/gross/boxes follow the same per-firm rule as the invoice line item (the
    firm's official net = ``quantity_kg``; gross/boxes fall back to the truck).
    ``plate`` is the whole-truck tractor/trailer string.
    """
    shipment = invoice.shipment
    gross_kg = (invoice.gross_kg if invoice.gross_kg is not None
                else (shipment.weight_gross if shipment else None))
    boxes = (invoice.box_count if invoice.box_count is not None
             else (shipment.box_count if shipment else None))
    return LetterFigures(
        net=invoice.quantity_kg, gross=gross_kg, boxes=boxes,
        plate=_truck_plate(shipment),
    )


def build_ct1_context(invoice, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """CT-1 certificate-of-origin request letter (RU): firm, contract, parties, weights.

    ``overrides`` is accepted for a uniform builder signature but unused here.
    """
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)
    fig = _letter_figures(invoice)
    return {
        'firm_name': _firm_attr(seller, 'name', lang),
        'firm_address': _firm_attr(seller, 'address', lang),
        'buyer_name': getattr(buyer, 'name_company', '') or '',
        'buyer_address': getattr(buyer, 'address', '') or '',
        'product': 'Свежие Помидоры',
        'contract_line': _contract_line(contract),
        'net': _kg(fig.net, lang),
        'gross': _kg(fig.gross, lang),
        'boxes': str(fig.boxes) if fig.boxes else '',
        'doc_date': _date(invoice.invoice_date),
    }


def build_fito_context(invoice, lang: str = 'ru', overrides: dict | None = None) -> dict:
    """Phytosanitary-certificate request letter (RU): firm, dest, weights, truck, parties.

    ``overrides`` is accepted for a uniform builder signature but unused here.
    """
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)
    fig = _letter_figures(invoice)
    return {
        'firm_name': _firm_attr(seller, 'name', lang),
        'firm_address': _firm_attr(seller, 'address', lang),
        'buyer_name': getattr(buyer, 'name_company', '') or '',
        'buyer_address': getattr(buyer, 'address', '') or '',
        'country': _country_name(invoice, lang),
        'product': 'Свежих Помидоров',
        'net': _kg(fig.net, lang),
        'boxes': str(fig.boxes) if fig.boxes else '',
        'plate': fig.plate,
        'doc_date': _date(invoice.invoice_date),
    }


def build_customs_context(invoice, lang: str = 'tk', overrides: dict | None = None) -> dict:
    """Customs-clearance request letter (ARZA, Turkmen): parties, contract, dest, cargo.

    Includes the truck-table fields (plate / product / boxes / gross) and the
    generate-time ``place_loading`` inserted into the boilerplate. ``overrides``
    supplies ``place_loading`` (blank when not chosen).
    """
    overrides = overrides or {}
    contract = invoice.contract
    seller = invoice.export_firm or (contract.export_firm if contract else None)
    buyer = invoice.import_firm or (contract.import_firm if contract else None)
    fig = _letter_figures(invoice)
    return {
        'seller_name': _firm_attr(seller, 'name', lang),
        'buyer_name': getattr(buyer, 'name_company', '') or '',
        'contract_line': _contract_line(contract),
        'country': _country_name(invoice, lang),
        'place_loading': overrides.get('place_loading', ''),
        'product': 'Ter pomidor',
        'plate': fig.plate,
        'gross': _kg(fig.gross, lang),
        'boxes': str(fig.boxes) if fig.boxes else '',
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
    """Turkmen date as ``DD.MM.YYYY ý.``, '' if None (kept as a fallback)."""
    if value is None:
        return ''
    return f'{value:%d.%m.%Y} ý.'


# Turkmen month names in the locative form the contract dates use
# ("…ýylyň 30-njy iýunyna"). Vowel harmony: back-vowel months take ``-yna``;
# the one front-vowel month (aprel) takes ``-ine``.
_TK_MONTHS_LOCATIVE = [
    '', 'ýanwaryna', 'fewralyna', 'martyna', 'apreline', 'maýyna', 'iýunyna',
    'iýulyna', 'awgustyna', 'sentýabryna', 'oktýabryna', 'noýabryna', 'dekabryna',
]

# Thin (front) vowels — an ordinal ending in one of these takes ``-nji``; a back
# vowel (a, u, y, o) takes ``-njy`` (rule confirmed by the export team).
_TK_THIN_VOWELS = set('ieüäö')


def _tk_ordinal(n: int) -> str:
    """Turkmen ordinal, e.g. ``30`` → ``30-njy``, ``31`` → ``31-nji``.

    The suffix follows vowel harmony of the number's spelled form: the last vowel
    of the last spoken word decides ``-nji`` (thin) vs ``-njy`` (back). Reuses the
    Turkmen number speller so compounds resolve correctly (``26`` → "ýigrimi alty"
    → back → ``-njy``).
    """
    words = amount_words_tk(n).split()
    last = words[-1] if words else ''
    last_vowel = next((c for c in reversed(last) if c in 'aeiouyäöü'), 'a')
    return f'{n}-nji' if last_vowel in _TK_THIN_VOWELS else f'{n}-njy'


def _date_tk_spelled(value: date | None) -> str:
    """Spelled Turkmen date: ``2026-njy ýylyň 30-njy iýunyna``, '' if None.

    The template supplies the trailing word (``çenli``), so this returns just
    ``<year-ord> ýylyň <day-ord> <month-locative>``.
    """
    if value is None:
        return ''
    return f'{_tk_ordinal(value.year)} ýylyň {_tk_ordinal(value.day)} {_TK_MONTHS_LOCATIVE[value.month]}'


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
    - **Buyer** = ``contract.import_firm``: the flat single-value fields the model
      has (``name_company`` / ``address`` / ``bank_details`` blob) shown in both
      language columns, plus the bilingual country name. The director name comes from
      the ``buyer_director`` override (the modal pre-fills it from the firm's
      ``contact_person`` "Director's Full Name" and lets it be edited), falling back
      to ``contact_person`` when the request carries no override.
    - **``delivery_deadline``** (§2.6) is a generate-time override; the validity date
      (§8.1) is ``Contract.end_date``.

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
    # Buyer director: the modal sends buyer_director (pre-filled from the firm's
    # "Director's Full Name" = ImportFirm.contact_person, and editable), so that wins;
    # contact_person is the fallback when the request carries no override.
    director = (overrides.get('buyer_director') or '').strip() or (
        getattr(buyer, 'contact_person', '') or ''
    ).strip()

    # Buyer — single-value model fields shown in both language columns; a multi-line
    # bank_details blob collapses to '; ' (a bare '\n' won't line-break in a docx run).
    buyer_name = getattr(buyer, 'name_company', '') or getattr(buyer, 'name_short', '') or ''
    buyer_address = getattr(buyer, 'address', '') or ''
    buyer_bank = _oneline(getattr(buyer, 'bank_details', '') or '')

    # Stamps: only when the request opts in AND the firm actually has the image.
    # Blank ('') otherwise → the placeholder renders nothing.
    want_stamps = str(overrides.get('stamps', '')).strip().lower() in ('1', 'true', 'yes', 'on')

    def _stamp(firm, field: str):
        f = getattr(firm, field, None)
        return StampImage(f) if (want_stamps and f and getattr(f, 'name', '')) else ''

    return {
        'contract_no': contract.contract_number or '',
        'contract_date': _date(contract.start_date),
        # Financials — one numeric value shown in both language columns (RU grouping).
        'total_sum': _money(amount, 'ru'),
        'total_sum_words_tk': amount_words_tk(whole_dollars) if whole_dollars is not None else '',
        'total_sum_words_ru': amount_words_ru(whole_dollars) if whole_dollars is not None else '',
        'quantity': _kg(qty, 'ru'),
        'price': _price(unit_price, 'ru'),
        # Dates — both spelled: RU genitive, TK ordinal (vowel-harmony suffix).
        'delivery_deadline_tk': _date_tk_spelled(deadline),
        'delivery_deadline_ru': _date_ru_spelled(deadline),
        'validity_tk': _date_tk_spelled(contract.end_date),
        'validity_ru': _date_ru_spelled(contract.end_date),
        # Seller (export firm) — name bare (template supplies the legal form).
        'seller_name_tk': _bare_seller_name(getattr(seller, 'name_tk', '') or ''),
        'seller_name_ru': _bare_seller_name(
            getattr(seller, 'name_ru', '') or getattr(seller, 'name_tk', '') or ''
        ),
        'seller_address_tk': getattr(seller, 'address_tk', '') or '',
        'seller_address_ru': getattr(seller, 'address_ru', '') or getattr(seller, 'address_tk', '') or '',
        # Director: RU/Cyrillic from `director`; TK/Latin from `director_tk` (falling
        # back to the RU form when the Turkmen spelling isn't filled).
        'seller_director_ru': _seller_director(seller),
        'seller_director_tk': (
            _DIRECTOR_TITLE.sub('', getattr(seller, 'director_tk', '') or '').strip()
            or _seller_director(seller)
        ),
        'seller_bank_tk': _oneline(getattr(seller, 'bank_details_tk', '') or ''),
        'seller_bank_ru': _oneline(
            getattr(seller, 'bank_details_ru', '') or getattr(seller, 'bank_details_tk', '') or ''
        ),
        # Buyer (import firm) — flat fields repeated across both columns; country
        # is genuinely bilingual; director is generate-time.
        'buyer_name_tk': buyer_name,
        'buyer_name_ru': buyer_name,
        'buyer_country_tk': getattr(country, 'name_tk', '') or '',
        'buyer_country_ru': getattr(country, 'name_ru', '') or getattr(country, 'name_tk', '') or '',
        'buyer_director_tk': director,
        'buyer_director_ru': director,
        'buyer_address_tk': buyer_address,
        'buyer_address_ru': buyer_address,
        'buyer_bank_tk': buyer_bank,
        'buyer_bank_ru': buyer_bank,
        # Signature-block stamps — only rendered when ?stamps=1 and the firm has
        # the image uploaded (else '' → nothing). Seller from ExportFirm, buyer
        # from ImportFirm.
        'seller_seal': _stamp(seller, 'director_seal'),
        'seller_signature': _stamp(seller, 'director_signature'),
        'buyer_seal': _stamp(buyer, 'director_seal'),
        'buyer_signature': _stamp(buyer, 'director_signature'),
    }


def contract_filename_fields(contract) -> dict:
    """Flat dict for the contract registry ``out_pattern`` (download filename)."""
    return {'contract_number': (contract.contract_number or 'NA').replace('/', '-')}
