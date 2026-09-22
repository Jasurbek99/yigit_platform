"""`/api/v1/core/blocks/` carries what the weekly-plan grids build rows from.

The grids list one row per plannable block, so they need `parent` (to drop
sub-blocks, which `write-cell` refuses) and `location_name` (the Dusak / Kaka /
Owadandepe grouping). Pinned here because the TypeScript `IGreenhouseBlock`
type already declared both fields long before this endpoint sent them.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import GreenhouseBlock, LoadingLocation


class BlockListFieldsTests(TestCase):
    URL = '/api/v1/core/blocks/?page_size=200'

    @classmethod
    def setUpTestData(cls):
        cls.dusak = LoadingLocation.objects.create(name='BLF-Dusak')
        cls.parent = GreenhouseBlock.objects.create(
            code='BLF-F', name='Block F', location=cls.dusak, is_active=True,
        )
        cls.child = GreenhouseBlock.objects.create(
            code='BLF-F1', name='Block F1', parent=cls.parent, is_active=True,
        )
        cls.unplaced = GreenhouseBlock.objects.create(code='BLF-X', name='No location', is_active=True)
        cls.user = get_user_model().objects.create_user(
            username='blf_transport', password='x', role='transport',
        )

    def _rows(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get(self.URL)
        self.assertEqual(response.status_code, 200, response.content[:300])
        data = response.data
        rows = data['results'] if isinstance(data, dict) else data
        return {row['code']: row for row in rows}

    def test_exposes_location_name(self):
        row = self._rows()['BLF-F']
        self.assertEqual(row['location'], self.dusak.id)
        self.assertEqual(row['location_name'], 'BLF-Dusak')

    def test_location_name_is_null_when_block_has_no_location(self):
        row = self._rows()['BLF-X']
        self.assertIsNone(row['location'])
        self.assertIsNone(row['location_name'])

    def test_exposes_parent_so_sub_blocks_can_be_told_apart(self):
        rows = self._rows()
        self.assertIsNone(rows['BLF-F']['parent'])
        self.assertEqual(rows['BLF-F1']['parent'], self.parent.id)

    def test_location_does_not_cost_a_query_per_block(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        client.get(self.URL)  # warm auth/session lookups
        with self.assertNumQueries(self._queries_for_one_page(client)):
            client.get(self.URL)

    def _queries_for_one_page(self, client):
        # Measure rather than hard-code: the count must not grow with the number
        # of blocks, so take it now and add blocks before re-measuring.
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as before:
            client.get(self.URL)
        for i in range(5):
            GreenhouseBlock.objects.create(
                code=f'BLF-N{i}', location=self.dusak, is_active=True,
            )
        return len(before.captured_queries)
