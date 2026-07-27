"""Shared fixture helper for Task.completed_by attribution tests.

Mirrors the minimal FK setup used in tests_sales_report_task.py: a Season
(with start/end dates) and a 'draft' ShipmentStatusType are enough for
Shipment.save() -> resolve_for_shipment() to run without touching any of the
optional geography/customer/product FKs.
"""
from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment

_SHIPMENT_SEQ = [0]


def make_basic_shipment(created_by):
    """Create and save a minimal Shipment owned by `created_by`.

    Each call gets a unique shipment_code so tests can run side by side
    without unique-constraint collisions.
    """
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'draft', 'name_en': 'draft', 'name_ru': 'draft',
            'step_order': 0, 'phase': 'DRAFT',
        },
    )
    _SHIPMENT_SEQ[0] += 1
    shipment = Shipment.objects.create(
        shipment_code=f'0101{_SHIPMENT_SEQ[0]:03d}/26',
        date='2026-01-01',
        season=season,
        status=status,
        created_by=created_by,
        updated_by=created_by,
    )
    return shipment
