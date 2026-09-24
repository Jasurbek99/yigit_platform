"""`carry_days` per block replaces the one global gaplama_carry_days (2026-09-24)."""
from django.core.exceptions import ValidationError
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


class BlockCarryDaysUpperBoundTests(TestCase):
    """2026-09-25: `build_gaplama_board`'s walk window is 2 x max(carry_days)
    ACROSS EVERY BLOCK, and each block's own bucket list inside that window
    is bounded by its own carry_days — one block typo'd to a huge value (no
    upper bound today) makes every board request walk years of days for
    every block, not just the mistyped one. A validator caps it."""

    def test_full_clean_rejects_a_wildly_large_value(self):
        block = GreenhouseBlock(code='CD4', carry_days=3650)
        with self.assertRaises(ValidationError):
            block.full_clean()

    def test_full_clean_accepts_the_upper_bound(self):
        block = GreenhouseBlock(code='CD5', carry_days=30)
        block.full_clean()  # must not raise
