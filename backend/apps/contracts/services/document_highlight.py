"""Red-highlight the dynamically-filled values in a rendered document.

Boilerplate stays black; anything that came from the database renders red, so the
office can see at a glance what the system filled in and catch a blank field
before printing. Ported from the sera-butce-web app, whose `.dyn`/`.red` CSS class
does the same for its HTML documents.

Pipeline (both halves live here, the render service calls them either side of the
docxtpl render):

    context ─ wrap_context ─→ 'value' ─ tpl.render ─→ doc ─ colorize ─→ red runs

Why sentinels instead of docxtpl's ``RichText``: ``RichText`` only works with the
``{{r tag }}`` prefix syntax, and it replaces the *whole* run — which discards the
template's bold/size/font and would force every (currently pure) context builder
to re-supply presentation. With plain ``{{ tag }}`` it silently emits invalid
OOXML (``<w:r>`` nested inside ``<w:t>``) that python-docx parses without
complaint. Wrapping and post-splitting keeps all 9 templates and all context
builders untouched, and inherits each run's existing formatting for free.
"""
from __future__ import annotations

import copy
import re

from docx.shared import RGBColor
from docx.text.run import Run

# Unicode Private Use Area — these can never occur in Turkmen/Russian/English
# source data, so a sentinel in the rendered output always means "we put it there".
OPEN = ''
CLOSE = ''

# Dark red rather than pure #FF0000: legible when the document is photocopied or
# faxed to customs, which is what happens to most of these papers.
HIGHLIGHT_RGB = RGBColor(0xC0, 0x00, 0x00)

_W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
_SPLIT_RE = re.compile(f'([{OPEN}{CLOSE}])')


def wrap_context(context: dict) -> dict:
    """Return ``context`` with every non-blank string wrapped in sentinels.

    Recurses into lists and dicts so the invoice's ``line_items`` rows are covered
    too. Non-string values pass through untouched — notably ``InlineImage`` (the
    resolved stamps) which must reach docxtpl as-is.

    Blank strings are deliberately NOT wrapped: a wrapped empty value would emit a
    stray red run, and an unwrapped blank stays falsy so a ``{% if %}`` added to a
    template later still behaves.
    """
    return {key: _wrap_value(value) for key, value in context.items()}


def _wrap_value(value):
    """Wrap one context value, recursing through the containers builders emit."""
    if isinstance(value, str):
        return f'{OPEN}{value}{CLOSE}' if value.strip() else value
    if isinstance(value, list):
        return [_wrap_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _wrap_value(item) for key, item in value.items()}
    return value


def colorize(doc) -> None:
    """Split sentinel-marked text into its own runs and colour it red, in place.

    Every paragraph in the document is visited — body, table cells (recursively,
    for nested tables), and each section's header and footer. No template
    currently puts a tag in a header/footer, but a sentinel that escaped there
    would print as a tofu box on paper, so they are covered anyway.
    """
    for paragraph in all_paragraphs(doc):
        _split_paragraph_runs(paragraph)


def all_paragraphs(doc) -> list:
    """Every paragraph in the document, including headers, footers and tables.

    Public because the layout service walks the same set to scale font sizes.
    """
    paragraphs = []
    _collect(doc, paragraphs)
    for section in doc.sections:
        for part in (section.header, section.footer,
                     section.first_page_header, section.first_page_footer,
                     section.even_page_header, section.even_page_footer):
            # Skip inherited headers/footers: their paragraphs belong to an
            # earlier section and are visited there, and touching a linked part
            # can materialise an empty header into the output document.
            if part is not None and not part.is_linked_to_previous:
                _collect(part, paragraphs)
    return paragraphs


def _collect(container, out: list) -> None:
    """Append a container's paragraphs, descending into nested tables."""
    out.extend(container.paragraphs)
    for table in container.tables:
        for row in table.rows:
            for cell in row.cells:
                _collect(cell, out)


def _split_paragraph_runs(paragraph) -> None:
    """Replace each sentinel-bearing run with black/red runs of the same style.

    The new runs are deep copies of the original ``<w:r>`` with its ``<w:t>``
    children stripped, so every run property (bold, size, font, spacing) carries
    over — that is what keeps the CMR's print registration and the invoice's
    8/9/10pt hierarchy intact. They are inserted *in place* via ``addnext``;
    appending to the paragraph would move the text to the end of the paragraph.
    """
    for run in list(paragraph.runs):
        text = run.text
        if OPEN not in text and CLOSE not in text:
            continue

        anchor = run._r
        previous = anchor
        for segment, is_dynamic in _segments(text):
            if not segment:
                continue
            element = copy.deepcopy(anchor)
            for text_node in element.findall(_W + 't'):
                element.remove(text_node)
            previous.addnext(element)
            previous = element
            new_run = Run(element, paragraph)
            new_run.text = segment
            if is_dynamic:
                new_run.font.color.rgb = HIGHLIGHT_RGB
        anchor.getparent().remove(anchor)


def _segments(text: str) -> list[tuple[str, bool]]:
    """Split run text into ``(segment, is_dynamic)`` pairs, dropping sentinels.

    A run can hold several values plus boilerplate between them — the invoice's
    '№ {{ invoice_no }} от {{ invoice_date }}' is one run in the template.
    """
    segments = []
    buffer = ''
    inside = False
    for token in _SPLIT_RE.split(text):
        if token == OPEN:
            segments.append((buffer, False))
            buffer, inside = '', True
        elif token == CLOSE:
            segments.append((buffer, True))
            buffer, inside = '', False
        else:
            buffer += token
    segments.append((buffer, inside))
    return segments
