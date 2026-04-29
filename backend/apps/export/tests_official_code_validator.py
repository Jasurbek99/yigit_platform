"""Tests for validate_official_export_code in apps.export.validators."""

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.core.models import TomatoVariety
from apps.export.validators import validate_official_export_code


class ValidateOfficialExportCodeTest(TestCase):
    """Unit tests for the 6-field official export code validator."""

    def setUp(self) -> None:
        """Create a minimal variety with code='02' to test field-6 resolution."""
        TomatoVariety.objects.create(code='02', name='Midelice')

    # ------------------------------------------------------------------
    # Valid cases
    # ------------------------------------------------------------------

    def test_valid_full_code(self) -> None:
        """22|AP|202|A4|26|02 should pass (variety 02 exists from setUp)."""
        validate_official_export_code('22|AP|202|A4|26|02')  # must not raise

    def test_valid_blank_string(self) -> None:
        """Empty string is allowed — field is optional on Shipment."""
        validate_official_export_code('')

    def test_valid_none(self) -> None:
        """None is allowed — field is null=True on Shipment."""
        validate_official_export_code(None)

    def test_valid_variety_unknown_dash(self) -> None:
        """Field 6 = '--' means variety unknown at draft time — allowed."""
        validate_official_export_code('01|YA|1|A|25|--')

    def test_valid_single_digit_sequence(self) -> None:
        """Sequence of 1 digit is valid per format spec."""
        validate_official_export_code('15|OC|5|B|24|02')

    def test_valid_four_digit_sequence(self) -> None:
        """Sequence of 4 digits is the max allowed."""
        validate_official_export_code('31|DC|1234|F1|25|02')

    def test_valid_three_char_block(self) -> None:
        """Block code up to 3 alphanumeric chars is valid."""
        validate_official_export_code('10|MY|100|A4B|26|02')

    # ------------------------------------------------------------------
    # Invalid cases
    # ------------------------------------------------------------------

    def test_invalid_wrong_field_count(self) -> None:
        """Too few fields (5 instead of 6) should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP|202|A4|26')

    def test_invalid_too_many_fields(self) -> None:
        """7 fields instead of 6 should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP|202|A4|26|02|extra')

    def test_invalid_bad_month_abbreviation(self) -> None:
        """Unknown month abbreviation XX should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|XX|202|A4|26|02')

    def test_invalid_day_out_of_range(self) -> None:
        """Day 32 is out of range (01-31) — should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('32|AP|202|A4|26|02')

    def test_invalid_day_zero(self) -> None:
        """Day 00 is out of range — should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('00|AP|202|A4|26|02')

    def test_invalid_unknown_variety_code(self) -> None:
        """Variety code '99' does not exist in DB — should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP|202|A4|26|99')

    def test_invalid_non_numeric_day(self) -> None:
        """Non-numeric day 'AB' should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('AB|AP|202|A4|26|02')

    def test_invalid_sequence_empty(self) -> None:
        """Empty sequence field should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP||A4|26|02')

    def test_invalid_sequence_five_digits(self) -> None:
        """Sequence of 5 digits exceeds max of 4 — should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP|12345|A4|26|02')

    def test_invalid_year_non_numeric(self) -> None:
        """Non-numeric year 'ZZ' should raise ValidationError."""
        with self.assertRaises(ValidationError):
            validate_official_export_code('22|AP|202|A4|ZZ|02')
