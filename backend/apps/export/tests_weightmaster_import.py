"""Tests for the weightmaster loading-detail Excel parser.

Builds an in-memory .xlsx matching the real template (header row 1, pallet rows
from row 2, blank column A ends the table) and verifies:
- rows resolve crate_type / variety / sub_block against reference data
- totals, harvest date and load code are extracted correctly
- unresolved variety/block produce a warning with a null id (never dropped)
- a non-template file raises WeightmasterParseError
"""
from decimal import Decimal
from io import BytesIO

import openpyxl
from django.test import TestCase

from apps.core.models import CrateType, GreenhouseBlock, TomatoVariety
from apps.export.services.weightmaster_import import (
    WeightmasterParseError,
    parse_weightmaster_workbook,
)

_HEADER = [
    'PALET №', 'DOLY AGRAM', '1 GAP AGRAM', 'GAP SANY', 'GAP AGRAMY (paletde)',
    'POLET AGRAM', 'GOŞUNDYLAR (ugalok/yup)', 'ARASSA AGRAMY', 'POMIDORYŇ GÖRNÜŞI',
    'KODLAMA', 'BÖLÜMI', 'GAP GÖRNÜŞI', 'ÝYGYLAN SENESI', 'PADDON GORNUSI',
]


def _build_workbook(rows: list[list]) -> BytesIO:
    """Build an in-memory weightmaster .xlsx from (A..N) row value lists."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(_HEADER)
    for r in rows:
        ws.append(r)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class WeightmasterParserTests(TestCase):
    def setUp(self):
        CrateType.objects.get_or_create(
            name='LEBIZ PLAST 18',
            defaults={'weight_kg': Decimal('0.543'), 'is_active': True},
        )
        TomatoVariety.objects.get_or_create(code='01', defaults={'name': 'Midelice'})
        TomatoVariety.objects.get_or_create(code='02', defaults={'name': 'Redity'})
        f = GreenhouseBlock.objects.create(code='F', name='F')
        GreenhouseBlock.objects.create(code='F1', name='F1', parent=f)
        GreenhouseBlock.objects.create(code='F2', name='F2', parent=f)

    def test_parses_and_resolves_rows(self):
        # A     B    C      D   E       F    G  H    I          J             K    L   M             N
        wb = _build_workbook([
            ['Palet 1', 474, 0.543, 64, 34.752, 7.5, 4, 427.748, 'MIDELICE', '10AP116-F01', 'F2', 'x', '10,04,2026', 'AGAÇ'],
            ['Palet 2', 703, 0.543, 96, 52.128, 9,   4, 637.872, 'REDITY',   '10AP116-F02', 'F1', 'x', '10,04,2026', 'AGAÇ'],
        ])
        result = parse_weightmaster_workbook(wb)

        self.assertEqual(len(result.rows), 2)
        self.assertEqual(len(result.warnings), 0)
        self.assertEqual(result.load_code, '10AP116')
        self.assertEqual(result.harvest_date, '2026-04-10')
        self.assertEqual(result.total_gross_kg, Decimal('1177'))

        r1 = result.rows[0]
        self.assertEqual(r1.pallet_number, 1)
        self.assertIsNotNone(r1.crate_type)
        self.assertEqual(r1.crate_type_name, 'LEBIZ PLAST 18')
        self.assertIsNotNone(r1.variety)
        self.assertEqual(r1.variety_name, 'Midelice')  # case-insensitive match
        self.assertIsNotNone(r1.sub_block)
        self.assertEqual(r1.sub_block_code, 'F2')

    def test_stops_at_blank_column_a(self):
        wb = _build_workbook([
            ['Palet 1', 474, 0.543, 64, 34.752, 7.5, 4, 427.748, 'MIDELICE', '10AP116-F01', 'F2', 'x', '10,04,2026', 'AGAÇ'],
            [None, None, None, None, None, None, None, None, None, None, None, None, 'PLASMAS', 24],  # totals-ish
            ['Palet 99', 999, 0.543, 64, 0, 7, 4, 0, 'MIDELICE', 'x', 'F2', 'x', '10,04,2026', 'x'],
        ])
        result = parse_weightmaster_workbook(wb)
        self.assertEqual(len(result.rows), 1)  # stopped at the blank row

    def test_unresolved_variety_and_block_warn_with_null_id(self):
        wb = _build_workbook([
            ['Palet 1', 474, 0.543, 64, 34.752, 7.5, 4, 427.748, 'UNKNOWNVAR', '10AP116-F01', 'ZZ', 'x', '10,04,2026', 'AGAÇ'],
        ])
        result = parse_weightmaster_workbook(wb)

        self.assertEqual(len(result.rows), 1)
        row = result.rows[0]
        self.assertIsNone(row.variety)
        self.assertEqual(row.variety_name, 'UNKNOWNVAR')  # raw text preserved
        self.assertIsNone(row.sub_block)
        self.assertEqual(row.sub_block_code, 'ZZ')

        fields = {w.field for w in result.warnings}
        self.assertIn('variety', fields)
        self.assertIn('sub_block', fields)

    def test_blank_gross_is_skipped_with_warning(self):
        """A blank gross cell must skip the row with a warning, not produce a
        garbage negative-net pallet."""
        wb = _build_workbook([
            ['Palet 1', None, 0.543, 64, 34.752, 7.5, 4, 0, 'MIDELICE', '10AP116-F01', 'F2', 'x', '10,04,2026', 'AGAÇ'],
        ])
        result = parse_weightmaster_workbook(wb)

        self.assertEqual(len(result.rows), 0)
        self.assertTrue(any(w.field == 'row' for w in result.warnings))

    def test_non_template_file_raises(self):
        wb = openpyxl.Workbook()
        wb.active['A1'] = 'Some other spreadsheet'
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        with self.assertRaises(WeightmasterParseError):
            parse_weightmaster_workbook(buf)


class WeightmasterImportEndpointTests(TestCase):
    """The dry-run import endpoint: routing, file upload, role gate, shape."""

    def setUp(self):
        from apps.core.models import Country, Season, ShipmentStatusType, User
        from apps.export.models import Shipment

        CrateType.objects.get_or_create(
            name='LEBIZ PLAST 18',
            defaults={'weight_kg': Decimal('0.543'), 'is_active': True},
        )
        TomatoVariety.objects.get_or_create(code='01', defaults={'name': 'Midelice'})
        GreenhouseBlock.objects.create(code='F2', name='F2')

        self.wm = User.objects.create_user(
            username='artykow', password='p', role='weight_master',
        )
        self.outsider = User.objects.create_user(
            username='rando', password='p', role='sales_rep',
        )
        country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
        season, _ = Season.objects.get_or_create(
            name='2026',
            defaults={'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31'},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
        )
        self.shipment = Shipment.objects.create(
            shipment_code='1004116/26', date='2026-04-10', season=season,
            country=country, status=status, created_by=self.wm,
            # code_mismatch compares the file's letter KODLAMA against export_code.
            export_code='10AP116/26',
        )

    def _upload_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        wb = _build_workbook([
            ['Palet 1', 474, 0.543, 64, 34.752, 7.5, 4, 427.748, 'MIDELICE', '10AP116-F01', 'F2', 'x', '10,04,2026', 'AGAÇ'],
        ])
        return SimpleUploadedFile(
            'wm.xlsx', wb.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )

    def _url(self):
        return f'/api/v1/export/shipments/{self.shipment.id}/pallets/import-weightmaster/'

    def test_weight_master_gets_preview(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(self.wm)
        resp = client.post(self._url(), {'file': self._upload_file()}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body['rows']), 1)
        self.assertEqual(body['summary']['load_code'], '10AP116')
        self.assertEqual(body['summary']['harvest_date'], '2026-04-10')
        self.assertFalse(body['summary']['code_mismatch'])
        self.assertEqual(body['warnings'], [])

    def test_outsider_role_forbidden(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(self.outsider)
        resp = client.post(self._url(), {'file': self._upload_file()}, format='multipart')
        self.assertEqual(resp.status_code, 403)

    def test_missing_file_returns_400(self):
        from rest_framework.test import APIClient
        client = APIClient()
        client.force_authenticate(self.wm)
        resp = client.post(self._url(), {}, format='multipart')
        self.assertEqual(resp.status_code, 400)

    def test_weight_master_can_save_pallets(self):
        """weight_master owns the manifest but has shipment.can_create=False;
        the in-body allowlist (not DynamicResourcePermission) must let them save."""
        from rest_framework.test import APIClient
        crate = CrateType.objects.get(name='LEBIZ PLAST 18')
        variety = TomatoVariety.objects.get(name='Midelice')
        block = GreenhouseBlock.objects.get(code='F2')
        client = APIClient()
        client.force_authenticate(self.wm)
        resp = client.post(
            f'/api/v1/export/shipments/{self.shipment.id}/pallets/',
            {'pallets': [{
                'pallet_number': 1, 'crate_type': crate.id, 'crate_count': 64,
                'gross_weight_kg': '474.00', 'pallet_weight_kg': '7.50',
                'additions_kg': '4.00', 'variety': variety.id, 'sub_block': block.id,
            }]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.shipment.pallets.count(), 1)
