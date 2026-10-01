"""Shipment code and default date follow the Ashgabat day, not UTC.

Found by the full-cycle E2E (2026-10-01, 00:10 Ashgabat = 19:10 UTC the day
before): a truck opened after local midnight got yesterday's code (3009…/26)
and, when no date was sent, yesterday's date.

Run:
    python manage.py test apps.export.tests_local_date_codes --keepdb
"""
import datetime as dt
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.services.shipment import generate_shipment_code

# 00:10 on 1 Oct in Ashgabat (UTC+5) is still 30 Sep in UTC.
AFTER_LOCAL_MIDNIGHT = dt.datetime(2026, 9, 30, 19, 10, tzinfo=dt.timezone.utc)


class ShipmentCodeUsesLocalDayTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'draft', 'name_en': 'Draft', 'name_ru': 'Draft', 'step_order': 0, 'phase': 'DRAFT'},
        )
        Season.objects.get_or_create(
            name='2026/2027', defaults={'start_date': '2026-08-01', 'end_date': '2027-07-31', 'is_active': True},
        )
        cls.user = User.objects.create_user(username='em_local_day', password='pw', role='export_manager')

    def test_code_after_local_midnight_carries_the_local_day(self):
        with mock.patch('django.utils.timezone.now', return_value=AFTER_LOCAL_MIDNIGHT):
            code = generate_shipment_code()
        self.assertTrue(code.startswith('0110'), code)

    def test_new_column_after_local_midnight_is_dated_today(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        with mock.patch('django.utils.timezone.now', return_value=AFTER_LOCAL_MIDNIGHT):
            resp = client.post('/api/v1/export/shipments/', {'is_draft': True}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['date'], '2026-10-01')
        self.assertTrue(resp.data['shipment_code'].startswith('0110'), resp.data['shipment_code'])
