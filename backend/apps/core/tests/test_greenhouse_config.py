from django.test import TestCase
from apps.core.models import GreenhouseConfig


class GaplamaCarryDaysTest(TestCase):
    def test_default_is_two(self):
        config = GreenhouseConfig.get_solo()
        self.assertEqual(config.gaplama_carry_days, 2)

    def test_field_is_positive_small_integer(self):
        field = GreenhouseConfig._meta.get_field('gaplama_carry_days')
        self.assertEqual(field.get_internal_type(), 'PositiveSmallIntegerField')
