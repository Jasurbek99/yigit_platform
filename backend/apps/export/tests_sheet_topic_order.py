"""Cross-language guard: every sheet row has a topic section.

The Sheet's iOS design variant re-groups rows by topic instead of by owner.
That mapping lives on the frontend
(``frontend/src/components/sheet/sheetTopicOrder.ts``), but the row list it must
cover lives here, in ``sheet_rows.py``. Nothing in either language can see the
other, so adding a row to ``DEFAULT_SHEET_ROWS`` without filing it in
``TOPIC_SECTIONS`` silently drops that row into the trailing "Other" section —
it still renders (the frontend never discards a row), but it lands in the wrong
place and nobody finds out.

This test reads the TypeScript file as text and asserts the two agree. It is
deliberately dumb about TS syntax: it only extracts quoted strings from the
``fields:`` arrays, which is enough to compare field-key sets.
"""
import re
from pathlib import Path

from django.test import SimpleTestCase

from apps.export.sheet_rows import DEFAULT_SHEET_ROWS

TOPIC_ORDER_TS = (
    Path(__file__).resolve().parents[3]
    / 'frontend' / 'src' / 'components' / 'sheet' / 'sheetTopicOrder.ts'
)


def _topic_section_fields() -> list[str]:
    """Every field key listed in TOPIC_SECTIONS, in file order (may repeat)."""
    source = TOPIC_ORDER_TS.read_text(encoding='utf-8')
    # Each section is `fields: [ 'a', 'b', ... ],` — grab the bracketed body,
    # then the quoted strings inside it.
    bodies = re.findall(r'fields:\s*\[(.*?)\]', source, re.S)
    return [key for body in bodies for key in re.findall(r"'([^']+)'", body)]


class SheetTopicOrderCoverageTests(SimpleTestCase):
    def test_topic_order_file_exists(self):
        """A moved/renamed frontend file must fail loudly, not skip the check."""
        self.assertTrue(
            TOPIC_ORDER_TS.is_file(),
            f'sheetTopicOrder.ts not found at {TOPIC_ORDER_TS} — update this test '
            f'if the file moved.',
        )

    def test_every_sheet_row_has_a_topic_section(self):
        listed = set(_topic_section_fields())
        actual = {row['field_key'] for row in DEFAULT_SHEET_ROWS}

        missing = sorted(actual - listed)
        self.assertEqual(
            missing, [],
            f'These sheet rows have no topic section and would fall into "Other" '
            f'in the iOS design variant: {missing}. Add them to TOPIC_SECTIONS in '
            f'{TOPIC_ORDER_TS.name}.',
        )

    def test_no_topic_section_names_a_dead_field(self):
        listed = _topic_section_fields()
        actual = {row['field_key'] for row in DEFAULT_SHEET_ROWS}

        stale = sorted(set(listed) - actual)
        self.assertEqual(
            stale, [],
            f'TOPIC_SECTIONS names fields that no longer exist in '
            f'DEFAULT_SHEET_ROWS: {stale}.',
        )

    def test_no_field_is_filed_under_two_sections(self):
        listed = _topic_section_fields()
        duplicates = sorted({key for key in listed if listed.count(key) > 1})
        self.assertEqual(duplicates, [], f'Field listed twice: {duplicates}.')
