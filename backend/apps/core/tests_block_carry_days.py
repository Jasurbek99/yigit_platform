"""`carry_days` per block replaces the one global gaplama_carry_days (2026-09-24)."""
from django.test import TestCase

from apps.core.models import GreenhouseBlock


class BlockCarryDaysTests(TestCase):
    def test_defaults_to_seven(self):
        """Every block starts at 7 — the owner's decision, not a cold-storage flag."""
        block = GreenhouseBlock.objects.create(code='CD1', name='Carry test')
        self.assertEqual(block.carry_days, 7)

    def test_is_settable_per_block(self):
        a = GreenhouseBlock.objects.create(code='CD2', carry_days=2)
        b = GreenhouseBlock.objects.create(code='CD3', carry_days=7)
        self.assertEqual(
            list(
                GreenhouseBlock.objects.filter(code__in=['CD2', 'CD3'])
                .order_by('code').values_list('carry_days', flat=True)
            ),
            [2, 7],
        )
        self.assertNotEqual(a.carry_days, b.carry_days)
