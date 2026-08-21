"""Template registry — the dumb lookup table for document generation.

Maps a stable ``document key`` (e.g. ``invoice_ru``) to its template file, the
scope of the primary object it renders, its language, the context-builder that
assembles the Jinja context, and the output filename pattern.

This is a plain Python dict, NOT a DB model: templates are developer-authored
Word files versioned in git, with the same lifecycle as code. A ``DocumentTemplate``
DB model is only warranted if non-developers must upload/swap templates at runtime
(deferred).

Variant *selection* (e.g. which of the five CMRs) is the caller's job, not the
registry's — keep this a flat lookup with one entry per concrete document/variant.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

TEMPLATES_DIR = Path(__file__).resolve().parent

# Scope of the primary object a document renders from.
SCOPE_INVOICE = 'invoice'
SCOPE_CONTRACT = 'contract'
SCOPE_SHIPMENT = 'shipment'


@dataclass(frozen=True)
class TemplateSpec:
    """One renderable document/variant.

    Attributes:
        key: Stable document key used by the API ``?type=`` param.
        filename: Template ``.docx`` file name within ``TEMPLATES_DIR``.
        scope: Which primary object this renders from (invoice/contract/shipment).
        language: Document language code ('ru' | 'en' | 'tk').
        version: Template version, recorded by the (deferred) audit model.
        context_builder: Dotted path to the builder ``(obj, lang) -> dict``,
            resolved lazily to avoid import cycles at module load.
        out_pattern: ``str.format`` pattern for the download filename (no extension),
            fed a flat dict of the primary object's display fields.
    """

    key: str
    filename: str
    scope: str
    language: str
    version: str
    context_builder: str
    out_pattern: str
    engine: str = 'docx'  # 'docx' (docxtpl) | 'xlsx' (openpyxl cell-fill overlay)

    @property
    def template_path(self) -> Path:
        """Absolute path to the template file."""
        return TEMPLATES_DIR / self.filename


REGISTRY: dict[str, TemplateSpec] = {
    'invoice_ru': TemplateSpec(
        key='invoice_ru',
        filename='invoice_ru.docx',
        scope=SCOPE_INVOICE,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_invoice_context',
        out_pattern='Invoice_{contract_number}_{invoice_number}_RU',
    ),
    'invoice_en': TemplateSpec(
        key='invoice_en',
        filename='invoice_en.docx',
        scope=SCOPE_INVOICE,
        language='en',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_invoice_context',
        out_pattern='Invoice_{contract_number}_{invoice_number}_EN',
    ),
    # CMR (road consignment note) — truck-level. Renders from a Shipment,
    # aggregating all export firms on the truck as senders. This is an XLSX
    # print-overlay onto the pre-printed official 24-box form (NOT a docx layout):
    # the builder returns a {cell: value} map filled into the geometry-preserving
    # template sheet. See document_templates/build_cmr_xlsx.py.
    'cmr_ru': TemplateSpec(
        key='cmr_ru',
        filename='cmr_ru.xlsx',
        scope=SCOPE_SHIPMENT,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_cmr_overlay',
        out_pattern='CMR_{shipment_code}_RU',
        engine='xlsx',
    ),
    'cmr_en': TemplateSpec(
        key='cmr_en',
        filename='cmr_en.xlsx',
        scope=SCOPE_SHIPMENT,
        language='en',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_cmr_overlay',
        out_pattern='CMR_{shipment_code}_EN',
        engine='xlsx',
    ),
    # Word counterparts of the CMR overlay, for users who want to edit before
    # printing. Same field values (build_cmr_overlay_values) placed on a Word
    # table whose geometry is derived from the xlsx template, so both formats
    # put every value in the same box. The .xlsx remains the registration
    # reference for printing onto the pre-printed form — see build_cmr_docx.py.
    'cmr_ru_docx': TemplateSpec(
        key='cmr_ru_docx',
        filename='cmr_ru_docx.docx',
        scope=SCOPE_SHIPMENT,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_cmr_overlay_values',
        out_pattern='CMR_{shipment_code}_RU',
    ),
    'cmr_en_docx': TemplateSpec(
        key='cmr_en_docx',
        filename='cmr_en_docx.docx',
        scope=SCOPE_SHIPMENT,
        language='en',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_cmr_overlay_values',
        out_pattern='CMR_{shipment_code}_EN',
    ),
    # Authority request letters — single-language (per the source forms).
    'ct1_ru': TemplateSpec(
        key='ct1_ru',
        filename='ct1_ru.docx',
        scope=SCOPE_INVOICE,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_ct1_context',
        out_pattern='CT1_{contract_number}_{invoice_number}_RU',
    ),
    'fito_ru': TemplateSpec(
        key='fito_ru',
        filename='fito_ru.docx',
        scope=SCOPE_INVOICE,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_fito_context',
        out_pattern='Fito_{contract_number}_{invoice_number}_RU',
    ),
    'customs_tk': TemplateSpec(
        key='customs_tk',
        filename='customs_tk.docx',
        scope=SCOPE_INVOICE,
        language='tk',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_customs_context',
        out_pattern='Customs_{contract_number}_{invoice_number}_TK',
    ),
    # Export contract (bilingual TK/RU agreement) — the one template that holds
    # BOTH languages in a single .docx, diverging from the one-language-per-file
    # convention above because the source is a two-column legal instrument.
    'contract_kz': TemplateSpec(
        key='contract_kz',
        filename='contract_kz.docx',
        scope=SCOPE_CONTRACT,
        language='ru',
        version='1.0',
        context_builder='apps.contracts.services.document_context.build_contract_context',
        out_pattern='Contract_{contract_number}_KZ',
    ),
}


# Documents whose geometry registers onto a pre-printed official form. Page-layout
# adjustments are refused for these: the xlsx overlay prints into the 24 boxes of
# the physical CMR, and the Word CMR's geometry is derived from that same overlay
# so both formats land every value in the same box. Nudging a margin here means
# the print no longer lines up with the paper.
LAYOUT_LOCKED_KEYS = frozenset({'cmr_ru', 'cmr_en', 'cmr_ru_docx', 'cmr_en_docx'})


def supports_layout(document_key: str) -> bool:
    """Whether a document key accepts saved page-layout adjustments."""
    return document_key in REGISTRY and document_key not in LAYOUT_LOCKED_KEYS


def layout_capable_keys() -> list[str]:
    """Registry keys that accept layout adjustments, in registry order."""
    return [key for key in REGISTRY if key not in LAYOUT_LOCKED_KEYS]


def get_spec(document_key: str) -> TemplateSpec:
    """Return the TemplateSpec for a document key.

    Args:
        document_key: A registry key such as ``invoice_ru``.

    Raises:
        KeyError: If the key is not registered.
    """
    return REGISTRY[document_key]


def resolve_builder(spec: TemplateSpec) -> Callable:
    """Import and return the context-builder callable for a spec.

    Resolved lazily (not at module import) to avoid a registry → services →
    models import cycle.
    """
    module_path, func_name = spec.context_builder.rsplit('.', 1)
    module = __import__(module_path, fromlist=[func_name])
    return getattr(module, func_name)
