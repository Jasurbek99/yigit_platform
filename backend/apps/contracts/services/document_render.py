"""Document render service — the generic, document-agnostic engine.

Pipeline:  registry spec → context builder → docxtpl fill → .docx bytes
                                                    │ (if pdf)
                                       LibreOffice ─┴─→ .pdf bytes

Mirrors the Boss-dashboard export contract (``apps/export/exports/*`` return raw
bytes; the view wraps them in an ``HttpResponse`` with an attachment header).

PDF conversion shells out to LibreOffice headless, which must be installed on the
server (``LIBREOFFICE_BIN`` setting, or ``soffice``/``libreoffice`` on PATH). When
it is absent, ``render_pdf`` raises ``DocumentRenderError`` with a clear message
rather than producing a broken file. The ``.docx`` path has no such dependency.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import time
import zipfile
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path

import openpyxl
from django.conf import settings
from django.core.cache import cache
from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage

from apps.contracts.document_templates import registry as tpl_registry
from apps.contracts.services import document_context
from apps.contracts.services.document_context import StampImage

logger = logging.getLogger(__name__)

DOCX_CONTENT_TYPE = (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
)
XLSX_CONTENT_TYPE = (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
)
PDF_CONTENT_TYPE = 'application/pdf'

# Per-scope extractor for the registry out_pattern (download filename) fields.
_FILENAME_FIELDS = {
    tpl_registry.SCOPE_INVOICE: document_context.invoice_filename_fields,
    tpl_registry.SCOPE_SHIPMENT: document_context.cmr_filename_fields,
    tpl_registry.SCOPE_CONTRACT: document_context.contract_filename_fields,
}


class DocumentRenderError(RuntimeError):
    """Raised when a document cannot be rendered (e.g. PDF converter missing)."""


class PdfBusyError(DocumentRenderError):
    """No PDF render slot was free within the wait window.

    Subclasses ``DocumentRenderError`` so the views already map it to HTTP 503
    ("service busy") with no extra handling.
    """


# ════════════════════════════════════════════════
# PDF concurrency limit (worker-starvation guard)
# ════════════════════════════════════════════════
# Each PDF request shells out to LibreOffice and blocks a worker for up to 120s.
# With only 3 uvicorn workers, a handful of concurrent PDF requests would stall
# the whole API. We cap the number of renders running at once across ALL workers
# via slot keys in the shared Redis cache; excess requests wait briefly, then get
# a 503 telling them to retry — the API stays responsive for everyone else.
PDF_MAX_CONCURRENCY = getattr(settings, 'PDF_MAX_CONCURRENCY', 2)
# Safety TTL on a held slot: if a worker dies mid-render the slot self-frees.
# Must exceed the 120s LibreOffice timeout so a live render never loses its slot.
_PDF_SLOT_TTL = 180
# How long a request waits for a free slot before giving up with 503.
_PDF_ACQUIRE_TIMEOUT = 8.0
_PDF_ACQUIRE_POLL = 0.25


@contextmanager
def _pdf_render_slot():
    """Hold one of ``PDF_MAX_CONCURRENCY`` render slots for the duration.

    Uses atomic ``cache.add`` (Redis SET NX) so the slot count is enforced across
    all gunicorn/uvicorn workers, not per-process. Raises :class:`PdfBusyError`
    if no slot frees within ``_PDF_ACQUIRE_TIMEOUT``.
    """
    deadline = time.monotonic() + _PDF_ACQUIRE_TIMEOUT
    held_key = None
    while held_key is None:
        for slot in range(PDF_MAX_CONCURRENCY):
            key = f'pdf:render:slot:{slot}'
            if cache.add(key, 1, _PDF_SLOT_TTL):
                held_key = key
                break
        if held_key is not None:
            break
        if time.monotonic() >= deadline:
            raise PdfBusyError(
                'PDF service is busy (too many conversions at once). '
                'Please try again in a moment.'
            )
        time.sleep(_PDF_ACQUIRE_POLL)
    try:
        yield
    finally:
        cache.delete(held_key)


def _resolve_stamp(tpl: DocxTemplate, value):
    """Turn a StampImage marker into a docxtpl InlineImage; '' if no image.

    Reads the FieldFile's bytes here (render layer does the I/O, builders stay
    pure). A missing/unreadable file degrades to '' rather than failing the doc.
    """
    if not isinstance(value, StampImage):
        return value
    field = value.file
    if not field or not getattr(field, 'name', ''):
        return ''
    try:
        field.open('rb')
        try:
            data = field.read()
        finally:
            field.close()
    except (OSError, ValueError):
        logger.warning('stamp image unreadable: %s', getattr(field, 'name', '?'))
        return ''
    return InlineImage(tpl, BytesIO(data), width=Mm(value.width_mm))


def render_docx(template_path: Path, context: dict) -> bytes:
    """Fill a ``.docx`` template with a Jinja context and return OOXML bytes.

    ``StampImage`` markers in the context are resolved to ``InlineImage`` here
    (they need the ``DocxTemplate``); every other value passes through untouched.
    """
    tpl = DocxTemplate(str(template_path))
    context = {key: _resolve_stamp(tpl, value) for key, value in context.items()}
    tpl.render(context)
    buf = BytesIO()
    tpl.save(buf)
    return buf.getvalue()


def render_xlsx(template_path: Path, cell_values: dict) -> bytes:
    """Fill an ``.xlsx`` overlay template by cell coordinate and return OOXML bytes.

    The template's geometry (column widths, row heights, print scale, merges) is
    preserved untouched — the builder returns a ``{coordinate: value}`` map that is
    written into the single active sheet. Used by the CMR print-overlay, whose
    layout must register on the pre-printed official form.
    """
    wb = openpyxl.load_workbook(template_path)
    ws = wb.active
    for coord, value in cell_values.items():
        ws[coord] = value
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _libreoffice_bin() -> str | None:
    """Locate the LibreOffice binary (setting first, then PATH)."""
    configured = getattr(settings, 'LIBREOFFICE_BIN', '') or ''
    if configured:
        return configured
    return shutil.which('soffice') or shutil.which('libreoffice')


def render_pdf(source_bytes: bytes, source_ext: str = 'docx') -> bytes:
    """Convert filled ``.docx`` / ``.xlsx`` bytes to PDF via LibreOffice headless.

    A unique ``-env:UserInstallation`` profile per call avoids the shared-profile
    lock that serializes/breaks concurrent headless conversions. LibreOffice picks
    its input filter from the file extension, so the source is written with its
    native ``source_ext`` (``docx`` for Word templates, ``xlsx`` for the CMR overlay).

    Raises:
        DocumentRenderError: If LibreOffice is not installed or conversion fails.
    """
    binary = _libreoffice_bin()
    if not binary:
        raise DocumentRenderError(
            'PDF export requires LibreOffice (set LIBREOFFICE_BIN or install '
            'soffice/libreoffice on the server). The native (.docx/.xlsx) export '
            'is unaffected.'
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / f'in.{source_ext}'
        src.write_bytes(source_bytes)
        profile = (tmp_path / 'lo_profile').as_uri()
        try:
            with _pdf_render_slot():
                subprocess.run(
                    [
                        binary, '--headless', f'-env:UserInstallation={profile}',
                        '--convert-to', 'pdf', '--outdir', str(tmp_path), str(src),
                    ],
                    check=True, capture_output=True, timeout=120,
                )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            logger.error('LibreOffice PDF conversion failed: %s', exc, exc_info=True)
            raise DocumentRenderError('PDF conversion failed.') from exc

        pdf = tmp_path / 'in.pdf'
        if not pdf.exists():
            raise DocumentRenderError('PDF conversion produced no output.')
        return pdf.read_bytes()


def generate(
    document_key: str, primary_obj, fmt: str = 'docx', overrides: dict | None = None,
) -> tuple[bytes, str, str]:
    """Render a registered document for a primary object.

    Args:
        document_key: A registry key (e.g. ``invoice_ru``).
        primary_obj: The Invoice/Contract/Shipment instance to render from.
        fmt: ``'docx'`` or ``'pdf'``.
        overrides: Optional generate-time field values (e.g. ``place_loading``,
            ``tir_carnet``) passed through to the context builder.

    Returns:
        ``(file_bytes, filename_with_extension, content_type)``.

    Raises:
        KeyError: Unknown document_key.
        ValueError: Unsupported fmt.
        DocumentRenderError: PDF requested but converter unavailable / failed.
    """
    # TODO(docs): persist generated documents.
    #   1. GeneratedDocument audit model — one row per generation (document_key,
    #      shipment/sale, user, timestamp) to back the "13:00 board": at a glance
    #      per truck, what's done vs pending. Doesn't block generation; it's
    #      progress tracking for the document team.
    #   2. Save-and-reuse — store the rendered file so that, if nothing about the
    #      truck changed since, re-download serves the saved copy instead of
    #      re-rendering (faster, and the PDF the office printed is preserved).
    #      Needs a "dirty since generated" check (e.g. compare shipment/sale
    #      updated_at vs the saved doc's timestamp) to know when to regenerate.
    if fmt not in ('docx', 'pdf'):
        raise ValueError(f'Unsupported format: {fmt!r}')

    spec = tpl_registry.get_spec(document_key)
    builder = tpl_registry.resolve_builder(spec)
    context = builder(primary_obj, spec.language, overrides)

    if spec.engine == 'xlsx':
        source_bytes = render_xlsx(spec.template_path, context)
        native_ext, native_type = 'xlsx', XLSX_CONTENT_TYPE
    else:
        source_bytes = render_docx(spec.template_path, context)
        native_ext, native_type = 'docx', DOCX_CONTENT_TYPE

    fields = _FILENAME_FIELDS[spec.scope](primary_obj)
    stem = spec.out_pattern.format(**fields)

    if fmt == 'pdf':
        return render_pdf(source_bytes, native_ext), f'{stem}.pdf', PDF_CONTENT_TYPE
    return source_bytes, f'{stem}.{native_ext}', native_type


ZIP_CONTENT_TYPE = 'application/zip'

# Per-firm request letters bundled into the packet (single-language forms).
_PACKET_LETTER_KEYS = ('ct1_ru', 'fito_ru', 'customs_tk')


def generate_packet_zip(shipment, sales, lang='ru', fmt='docx', overrides=None) -> bytes:
    """Bundle a truck's whole document packet into a single zip.

    Contents: the truck-level CMR, then per firm (each ``ContractSale`` in
    ``sales``) that firm's invoice + the CT-1 / FITO / customs request letters.
    Filenames are the same per-document names ``generate`` produces, so nothing
    collides (invoice/CMR names carry the contract/invoice/shipment code).

    Args:
        shipment: the ``Shipment`` (truck) — drives the CMR.
        sales: its ``ContractSale`` rows (firms with a linked contract). Firms
            without a sale have no invoice/letters, so they're simply absent.
        lang: ``'ru'`` | ``'en'`` — CMR + invoice language (letters are fixed-lang).
        fmt: ``'docx'`` | ``'pdf'`` — applied to every document in the packet.
        overrides: generate-time values (``place_loading`` / ``tir_carnet``).

    Raises:
        ValueError / DocumentRenderError: propagated from ``generate`` (e.g. PDF
        requested but LibreOffice missing) — the whole packet fails as one.
    """
    # The Word CMR (``cmr_*_docx``) is the form the office uses — same as the CMR
    # button; the xlsx overlay (``cmr_*``) is not offered in the UI.
    cmr_key = 'cmr_en_docx' if lang == 'en' else 'cmr_ru_docx'
    invoice_key = 'invoice_en' if lang == 'en' else 'invoice_ru'

    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
        data, filename, _ = generate(cmr_key, shipment, fmt, overrides)
        archive.writestr(filename, data)
        for sale in sales:
            for key in (invoice_key, *_PACKET_LETTER_KEYS):
                data, filename, _ = generate(key, sale, fmt, overrides)
                archive.writestr(filename, data)
    return buf.getvalue()
