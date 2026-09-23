"""A destination country carries its own "Serhet nokady", and a truck inherits it.

``Country.border_point`` is admin-managed from the Truck Destinations page.
``Shipment.save()`` copies it into an empty ``border_point`` when — and only
when — the destination country *changes*, which is what makes R29 non-empty
without anyone typing in it, and closes the ``tasks.set_border_point`` gate in
the same request.

The "only on a change" half is the load-bearing one. Commit 26e438d1
deliberately left 69 open drafts with no border point, and the 2026-09-23
decision was not to backfill them: if the fill ran on every save, the next edit
to any field of those drafts would have stamped one on anyway. The
``_loaded_country_id`` snapshot is what keeps that from happening, and
``test_an_unrelated_save_on_an_old_shipment_fills_nothing`` is what keeps the
snapshot.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    BorderPoint,
    Country,
    Customer,
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, ShipmentBlockSource, Task, TaskState
from apps.export.services.task_rules import generate_tasks_for_status


class CountryBorderPointDefaultTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in [('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='bpd_transport', password='pw', role='transport',
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True,
            },
        )
        cls.farap = BorderPoint.objects.create(name='Farap', name_ru='Фарап')
        cls.garabogaz = BorderPoint.objects.create(name='Garabogaz', name_ru='Гарабогаз')
        cls.kazakhstan = Country.objects.create(
            name_tk='Gazagystan', name_en='Kazakhstan', code='KZ', border_point=cls.farap,
        )
        cls.uzbekistan = Country.objects.create(
            name_tk='Ozbegistan', name_en='Uzbekistan', code='UZ',
        )

    def _draft(self, code: str, **extra) -> Shipment:
        return Shipment.objects.create(
            shipment_code=code,
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.user,
            updated_by=self.user,
            **extra,
        )

    def test_assigning_the_country_fills_the_border_point(self):
        shipment = self._draft('BPD-1')
        self.assertIsNone(shipment.border_point_id)

        shipment.country = self.kazakhstan
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.border_point_id, self.farap.id)

    def test_a_shipment_created_with_a_country_gets_it_too(self):
        shipment = self._draft('BPD-2', country=self.kazakhstan)

        shipment.refresh_from_db()
        self.assertEqual(shipment.border_point_id, self.farap.id)

    def test_an_operator_choice_is_never_overwritten(self):
        """Transport owns R29 — the country default only fills an empty cell."""
        shipment = self._draft('BPD-3', border_point=self.garabogaz)

        shipment.country = self.kazakhstan
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.border_point_id, self.garabogaz.id)

    def test_a_country_with_no_default_leaves_the_cell_empty(self):
        shipment = self._draft('BPD-4', country=self.uzbekistan)

        shipment.refresh_from_db()
        self.assertIsNone(shipment.border_point_id)

    def test_an_unrelated_save_on_an_old_shipment_fills_nothing(self):
        """No stealth backfill: the 69 pre-existing empty drafts stay empty."""
        shipment = self._draft('BPD-5', country=self.uzbekistan)
        Country.objects.filter(pk=self.uzbekistan.pk).update(border_point=self.farap)

        shipment = Shipment.objects.get(pk=shipment.pk)
        shipment.driver_name = 'Myrat'
        shipment.save()

        shipment.refresh_from_db()
        self.assertIsNone(shipment.border_point_id)

    def test_an_update_fields_save_still_persists_the_fill(self):
        """update_fields writes only the named columns — border_point must join."""
        shipment = self._draft('BPD-6')

        shipment = Shipment.objects.get(pk=shipment.pk)
        shipment.country = self.kazakhstan
        shipment.save(update_fields=['country'])

        shipment.refresh_from_db()
        self.assertEqual(shipment.border_point_id, self.farap.id)

    def test_the_fill_closes_the_transport_task(self):
        shipment = self._draft('BPD-7')
        generate_tasks_for_status(shipment, 'draft')
        task = Task.objects.get(shipment=shipment, title_key='tasks.set_border_point')
        self.assertEqual(task.state, TaskState.OPEN)

        shipment.country = self.kazakhstan
        shipment.save()

        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.DONE)


class BorderPointDefaultApiTests(TestCase):
    """The two paths an export manager actually uses to set a destination.

    Both go through ``Shipment.save()``, but only through a serializer and a
    view — and the Sheet reads the PATCH response, so the filled value has to
    be in the body, not merely in the DB.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        for code, order, phase in [('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS')]:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='bpd_mgr', password='pw', role='export_manager',
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True,
            },
        )
        cls.farap = BorderPoint.objects.create(name='Farap', name_ru='Фарап')
        cls.kazakhstan = Country.objects.create(
            name_tk='Gazagystan', name_en='Kazakhstan', code='KZ', border_point=cls.farap,
        )
        cls.customer = Customer.objects.create(name='Berik')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.shipment = Shipment.objects.create(
            shipment_code='BPD-API-1',
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='draft'),
            created_by=self.user,
            updated_by=self.user,
        )

    def test_a_sheet_country_edit_returns_the_filled_border_point(self):
        response = self.client.patch(
            f'/api/v1/export/shipments/{self.shipment.pk}/',
            {'country': self.kazakhstan.id},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['border_point'], self.farap.id)
        self.assertEqual(response.data['border_point_name'], 'Farap')

    def test_assign_fills_it_and_the_promotion_keeps_it(self):
        """/assign/ saves with update_fields and then transitions — both survive."""
        block = GreenhouseBlock.objects.create(code='BPD-A', name='BPD-A')
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=block, weight_kg=10000,
        )

        response = self.client.post(
            f'/api/v1/export/shipments/{self.shipment.pk}/assign/',
            {'country': self.kazakhstan.id, 'customer': self.customer.id},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['border_point'], self.farap.id)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')
        self.assertEqual(self.shipment.border_point_id, self.farap.id)
