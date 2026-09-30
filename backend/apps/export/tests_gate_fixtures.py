"""Shared setup for the gate tests. A plain mixin — it holds no tests itself."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.core.models import GreenhouseBlock, LoadingLocation, Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import Command as SeedTaskRulesCommand
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [
    ('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS'), ('gumruk_chykysh', 2, 'CUSTOMS'),
    ('yuklenme', 3, 'LOADING'), ('yola_chykdy', 4, 'TRANSIT'), ('serhet_gechdi', 5, 'BORDER'),
    ('dest_entry', 6, 'BORDER'), ('barysh_gumrugi', 7, 'BORDER'), ('transshipment', 8, 'SALES'),
    ('bardy', 9, 'SALES'), ('satylyar', 10, 'SALES'), ('satyldy', 11, 'SALES'),
    ('tamamlandy', 12, 'COMPLETE'), ('cancelled', 99, 'COMPLETE'),
]


class GateFixtures:

    @classmethod
    def make_gate_world(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                          'step_order': order, 'phase': phase},
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
        )
        cls.dusak = LoadingLocation.objects.create(name='Dusak')
        cls.kaka = LoadingLocation.objects.create(name='Kaka')
        cls.block_d = GreenhouseBlock.objects.create(code='GD', location=cls.dusak)
        cls.block_k = GreenhouseBlock.objects.create(code='GK', location=cls.kaka)
        cls.guard = User.objects.create_user(
            username='gate_d', password='pw', role='garawul', loading_location=cls.dusak,
        )
        cls.guard_kaka = User.objects.create_user(
            username='gate_k', password='pw', role='garawul', loading_location=cls.kaka,
        )
        cls.head = User.objects.create_user(username='gate_head', password='pw', role='loading_dept_head')
        cls.deputy = User.objects.create_user(
            username='gate_dep', password='pw', role='loading_dept_head_deputy',
        )
        cls.idle_deputy = User.objects.create_user(
            username='gate_dep_off', password='pw', role='loading_dept_head_deputy', is_active=False,
        )

    def make_truck(self, code, *, status='gumruk_chykysh', block=None, plate='1535AKM',
                   days=0, **extra) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code,
            date=timezone.localdate() + timedelta(days=days),
            season=extra.pop('season', self.season),
            status=ShipmentStatusType.objects.get(code=status),
            truck_plate=plate,
            created_by=self.head,
            updated_by=self.head,
            **extra,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=block or self.block_d, weight_kg=Decimal('1000'),
        )
        generate_tasks_for_status(shipment, status)
        return Shipment.objects.select_related('status').get(pk=shipment.pk)
