"""Firm letterhead (.docx) helpers — the «№ ___» blank (spec 2026-10-05).

Pure python-docx, no Django: export's admin serializer validates uploads with
it and contracts' renderer fills the number with it, so both agree on what
counts as the blank.
"""
from __future__ import annotations

import re
import zipfile
import zlib

from docx import Document
from docx.opc.exceptions import PackageNotFoundError
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from lxml.etree import XMLSyntaxError

NUMBER_SIGN = '№'
_BLANK = re.compile(r'_{3,}')

MISSING_BLANK_MESSAGE = (
    'В бланке не найдено «№ ___» — поставьте № и подчёркивания там, где печатать номер.'
)
PAGE_HEADER_MESSAGE = (
    'В бланке есть текст или картинка в колонтитуле Word — в письмо он не попадёт. '
    'Перенесите шапку из колонтитула в сам документ и загрузите снова.'
)
UNREADABLE_MESSAGE = (
    'Файл бланка не открывается. Пересохраните его в Word как .docx '
    '(без внедрения шрифтов) и загрузите снова.'
)

# What python-docx raises on a file it cannot read: not a zip / truncated
# (BadZipFile), a damaged part such as a broken embedded font (zlib.error), a zip
# that is not a Word package (KeyError / PackageNotFoundError), malformed XML.
UNREADABLE_DOCX_ERRORS = (
    zipfile.BadZipFile, zlib.error, KeyError, ValueError, PackageNotFoundError, XMLSyntaxError,
)


def _paragraphs(doc):
    """Every body paragraph, including ones in tables and text boxes."""
    return [Paragraph(p, doc._body) for p in doc.element.body.iter(qn('w:p'))]


def _blank_span(doc):
    """The first ``___`` after a ``№`` as ``[(run, start, end), ...]`` — it may span runs.

    Word splits a blank into several runs on any formatting change, so the text
    after the sign is joined across the paragraph's runs before searching.
    """
    for paragraph in _paragraphs(doc):
        segments, seen_sign = [], False
        for run in paragraph.runs:
            offset = 0
            if not seen_sign:
                idx = run.text.find(NUMBER_SIGN)
                if idx < 0:
                    continue
                seen_sign, offset = True, idx + 1
            segments.append((run, offset))
        if not seen_sign:
            continue
        match = _BLANK.search(''.join(run.text[offset:] for run, offset in segments))
        if match is None:
            continue
        span, pos = [], 0
        for run, offset in segments:
            length = len(run.text) - offset
            lo, hi = max(match.start(), pos), min(match.end(), pos + length)
            if lo < hi:
                span.append((run, offset + lo - pos, offset + hi - pos))
            pos += length
        return span
    return None


def number_blank_run(doc):
    """The run where the «№ ___» blank's underscores start, or None."""
    span = _blank_span(doc)
    return span[0][0] if span else None


def fill_number(doc, number: int | None) -> None:
    """Put ``number`` in place of the blank's underscores (the ones after the ``№``)."""
    if number is None:
        return
    for index, (run, lo, hi) in enumerate(_blank_span(doc) or []):
        run.text = run.text[:lo] + (str(number) if index == 0 else '') + run.text[hi:]


def _page_header_content(doc) -> bool:
    """Whether any Word page header/footer carries text or a picture."""
    for section in doc.sections:
        for part in (section.header, section.footer, section.first_page_header,
                     section.first_page_footer, section.even_page_header, section.even_page_footer):
            if part.is_linked_to_previous:
                continue
            element = part._element
            if (''.join(element.itertext()).strip()
                    or element.find('.//' + qn('w:drawing')) is not None
                    or element.find('.//' + qn('w:pict')) is not None):
                return True
    return False


def validate_letterhead(fileobj) -> None:
    """Raise ``ValueError`` unless ``fileobj`` is a readable .docx with a «№ ___»."""
    try:
        doc = Document(fileobj)
    except UNREADABLE_DOCX_ERRORS as exc:
        raise ValueError(UNREADABLE_MESSAGE) from exc
    if number_blank_run(doc) is None:
        raise ValueError(MISSING_BLANK_MESSAGE)
    if _page_header_content(doc):
        # The letter merge keeps only the document body — a page header never prints.
        raise ValueError(PAGE_HEADER_MESSAGE)
