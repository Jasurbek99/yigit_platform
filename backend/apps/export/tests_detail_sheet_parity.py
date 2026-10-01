"""GET /shipments/{id}/ carries the Sheet-parity fields the Detail page renders
(docs/superpowers/specs/2026-09-30-shipment-detail-full-design.md §6)."""
from decimal import Decimal

from rest_framework.test import APITestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    FinansistAdvance,
    FinansistAdvanceShipment,
    SheetRowSetting,
    Shipment,
    ShipmentCustomFieldValue,
)


class DetailSheetParityTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        # 'draft' is seeded by a data migration.
        cls.draft, _ = ShipmentStatusType.objects.get_or_create(
            code='draft', defaults={'name_tk': 'Taýýarlyk', 'step_order': 0},
        )
        # Read is gated by shipment.can_view; the test DB has no seeded role
        # perms, so use a superuser (same as tests_completeness_api.py).
        cls.user = User.objects.create_superuser(username='boss', password='pw')
        cls.shipment = Shipment.objects.create(
            shipment_code='0101002/26', date='2026-01-01', status=cls.draft, season=cls.season,
            shelf_life_days=12, pallet_weight_kg=Decimal('25.00'),
            greenhouse_arrived_at='2026-01-01T08:00:00Z',
        )

    def _get(self) -> dict:
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f'/api/v1/export/shipments/{self.shipment.id}/')
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_scalar_parity_fields(self):
        data = self._get()
        self.assertEqual(data['shelf_life_days'], 12)
        self.assertEqual(Decimal(data['pallet_weight_kg']), Decimal('25.00'))
        self.assertIsNotNone(data['greenhouse_arrived_at'])
        for key in ('packing_template', 'packing_template_name', 'truck_head_2_id', 'driver_2_id'):
            self.assertIn(key, data)
            self.assertIsNone(data[key])

    def test_has_current_advance_follows_linked_advance(self):
        self.assertFalse(self._get()['has_current_advance'])
        advance = FinansistAdvance.objects.create(
            advance_date='2026-01-02', total_amount=Decimal('100'), currency='TMT', issued_by=self.user,
        )
        FinansistAdvanceShipment.objects.create(advance=advance, shipment=self.shipment)
        self.assertTrue(self._get()['has_current_advance'])

    def test_custom_fields_list_visible_rows_with_values(self):
        filled = SheetRowSetting.objects.create(
            field_key='custom_seal', row_number=90, display_order=90_000, is_custom=True,
            label_tk='Plomba', label_ru='Пломба', label_en='Seal',
        )
        SheetRowSetting.objects.create(
            field_key='custom_empty', row_number=91, display_order=91_000, is_custom=True,
            label_tk='Boş', label_ru='Пусто', label_en='Empty',
        )
        SheetRowSetting.objects.create(
            field_key='custom_hidden', row_number=92, display_order=92_000, is_custom=True,
            is_visible=False, label_tk='Gizlin', label_ru='Скрыто', label_en='Hidden',
        )
        ShipmentCustomFieldValue.objects.create(shipment=self.shipment, row=filled, value_text='A-17')

        entries = self._get()['custom_fields']

        self.assertEqual(
            [(e['field_key'], e['value']) for e in entries],
            [('custom_seal', 'A-17'), ('custom_empty', None)],
        )
        self.assertEqual(entries[0]['label_ru'], 'Пломба')
