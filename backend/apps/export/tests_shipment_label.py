"""Tests for GET /export/shipments/{id}/label/ — A5 QR pallet label PDF."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment


class ShipmentLabelTests(TestCase):
    def setUp(self):
        # get_or_create: a seeded test DB already holds these rows from the
        # migrations, and create() hit the unique index on `code`.
        season, _ = Season.objects.get_or_create(
            name='lbl',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30',
                      'is_active': True},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='yola_chykdy',
            defaults={'name_tk': 'x', 'name_en': 'x', 'step_order': 5,
                      'phase': 'TRANSIT'},
        )
        self.shipment = Shipment.objects.create(
            shipment_code='0000001/26', date='2026-01-15', season=season, status=status,
            export_code='12JN121/26',
        )
        user = User(username='admin_lbl', role='admin', is_superuser=True)
        user.set_password('pass')
        user.save()
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.url = f'/api/v1/export/shipments/{self.shipment.pk}/label/'

    @override_settings(PLATFORM_URL='https://ygt.example')
    def test_returns_a5_pdf(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertIn('label_12JN121-26.pdf', resp['Content-Disposition'])
        self.assertTrue(resp.content.startswith(b'%PDF'))
        # A5 portrait in points.
        self.assertIn(b'/MediaBox [ 0 0 419.5276 595.2756 ]', resp.content)

    def test_missing_export_code_is_400(self):
        Shipment.objects.filter(pk=self.shipment.pk).update(export_code='')
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 400)


class ShipmentLabelBaseUrlTests(TestCase):
    """Which host the printed QR encodes, in precedence order.

    This is admin-settable because the value is PRINTED: the label travels with
    the truck and cannot be re-pointed once the host changes.
    """

    def setUp(self):
        season, _ = Season.objects.get_or_create(
            name='lblcfg',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30',
                      'is_active': True},
        )
        status, _ = ShipmentStatusType.objects.get_or_create(
            code='yola_chykdy',
            defaults={'name_tk': 'x', 'name_en': 'x', 'step_order': 5,
                      'phase': 'TRANSIT'},
        )
        self.shipment = Shipment.objects.create(
            shipment_code='0000003/26', date='2026-01-15', season=season,
            status=status, export_code='CFG1/26',
        )
        user = User(username='admin_lblcfg', role='admin', is_superuser=True)
        user.set_password('pass')
        user.save()
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.url = f'/api/v1/export/shipments/{self.shipment.pk}/label/'

    def _qr_payload_present(self, pdf_bytes: bytes) -> bool:
        """A QR's modules are drawn as vector paths, so the URL is not greppable
        in the PDF — assert on the config read instead (below)."""
        return pdf_bytes.startswith(b'%PDF')

    @override_settings(PLATFORM_URL='https://env.example')
    def test_config_value_wins_over_platform_url(self):
        from unittest import mock

        from apps.core.models import GreenhouseConfig

        cfg = GreenhouseConfig.get_solo()
        cfg.scan_base_url = 'https://admin.example'
        cfg.save(update_fields=['scan_base_url'])

        with mock.patch('apps.export.views.build_shipment_label_pdf') as build:
            build.return_value = b'%PDF-1.4 stub'
            self.client.get(self.url)

        build.assert_called_once()
        self.assertEqual(
            build.call_args[0][1], f'https://admin.example/scan/{self.shipment.pk}',
        )

    @override_settings(PLATFORM_URL='https://env.example')
    def test_blank_config_falls_back_to_platform_url(self):
        from unittest import mock

        from apps.core.models import GreenhouseConfig

        cfg = GreenhouseConfig.get_solo()
        cfg.scan_base_url = ''
        cfg.save(update_fields=['scan_base_url'])

        with mock.patch('apps.export.views.build_shipment_label_pdf') as build:
            build.return_value = b'%PDF-1.4 stub'
            self.client.get(self.url)

        self.assertEqual(
            build.call_args[0][1], f'https://env.example/scan/{self.shipment.pk}',
        )

    def test_trailing_slash_is_not_doubled(self):
        from unittest import mock

        from apps.core.models import GreenhouseConfig

        cfg = GreenhouseConfig.get_solo()
        cfg.scan_base_url = 'https://admin.example/'
        cfg.save(update_fields=['scan_base_url'])

        with mock.patch('apps.export.views.build_shipment_label_pdf') as build:
            build.return_value = b'%PDF-1.4 stub'
            self.client.get(self.url)

        self.assertEqual(
            build.call_args[0][1], f'https://admin.example/scan/{self.shipment.pk}',
        )
