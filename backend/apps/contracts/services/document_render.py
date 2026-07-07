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
from io import BytesIO
from pathlib import Path

from django.conf import settings
from docxtpl import DocxTemplate

from apps.contracts.document_templates import registry as tpl_registry
from apps.contracts.services import document_context

logger = logging.getLogger(__name__)

DOCX_CONTENT_TYPE = (
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
)
PDF_CONTENT_TYPE = 'application/pdf'

# Per-scope extractor for the registry out_pattern (download filename) fields.
_FILENAME_FIELDS = {
    tpl_registry.SCOPE_INVOICE: document_context.invoice_filename_fields,
    tpl_registry.SCOPE_SHIPMENT: document_context.cmr_filename_fields,
}


class DocumentRenderError(RuntimeError):
    """Raised when a document cannot be rendered (e.g. PDF converter missing)."""


def render_docx(template_path: Path, context: dict) -> bytes:
    """Fill a ``.docx`` template with a Jinja context and return OOXML bytes."""
    tpl = DocxTemplate(str(template_path))
    tpl.render(context)
    buf = BytesIO()
    tpl.save(buf)
    return buf.getvalue()


def _libreoffice_bin() -> str | None:
    """Locate the LibreOffice binary (setting first, then PATH)."""
    configured = getattr(settings, 'LIBREOFFICE_BIN', '') or ''
    if configured:
        return configured
    return shutil.which('soffice') or shutil.which('libreoffice')


def render_pdf(docx_bytes: bytes) -> bytes:
    """Convert filled ``.docx`` bytes to PDF via LibreOffice headless.

    A unique ``-env:UserInstallation`` profile per call avoids the shared-profile
    lock that serializes/breaks concurrent headless conversions.

    Raises:
        DocumentRenderError: If LibreOffice is not installed or conversion fails.
    """
    binary = _libreoffice_bin()
    if not binary:
        raise DocumentRenderError(
            'PDF export requires LibreOffice (set LIBREOFFICE_BIN or install '
            'soffice/libreoffice on the server). The .docx export is unaffected.'
        )

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / 'in.docx'
        src.write_bytes(docx_bytes)
        profile = (tmp_path / 'lo_profile').as_uri()
        try:
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
    if fmt not in ('docx', 'pdf'):
        raise ValueError(f'Unsupported format: {fmt!r}')

    spec = tpl_registry.get_spec(document_key)
    builder = tpl_registry.resolve_builder(spec)
    context = builder(primary_obj, spec.language, overrides)

    docx_bytes = render_docx(spec.template_path, context)

    fields = _FILENAME_FIELDS[spec.scope](primary_obj)
    stem = spec.out_pattern.format(**fields)

    if fmt == 'pdf':
        return render_pdf(docx_bytes), f'{stem}.pdf', PDF_CONTENT_TYPE
    return docx_bytes, f'{stem}.docx', DOCX_CONTENT_TYPE
