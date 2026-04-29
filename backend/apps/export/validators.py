"""Field validators for the export app."""

from django.core.exceptions import ValidationError

# Month abbreviations used in the official 6-field export code.
_VALID_MONTHS = {'YA', 'FB', 'MR', 'AP', 'MY', 'IY', 'IL', 'AG', 'SP', 'OC', 'NO', 'DC'}


def validate_official_export_code(value: str) -> None:
    """Validate the 6-field official export code format.

    Format: DD|MM|NNN|BLK|YY|VV, e.g. ``22|AP|202|A4|26|02``.

    Fields:
        DD  — 2-digit day (01-31)
        MM  — month abbreviation (YA FB MR AP MY IY IL AG SP OC NO DC)
        NNN — 1-4 digit sequence number
        BLK — 1-3 alphanumeric block code (A, A4, F1, …)
        YY  — 2-digit year
        VV  — variety code matching TomatoVariety.code, OR ``--`` / empty (unknown)

    Blank / None values are accepted because the field is optional on the
    Shipment model (variety may be unknown at draft creation).

    Args:
        value: The raw field value to validate.

    Raises:
        ValidationError: When the format is invalid.
    """
    if not value:
        return

    parts = value.split('|')
    if len(parts) != 6:
        raise ValidationError(
            f"Official export code must have exactly 6 fields separated by '|' "
            f"(got {len(parts)})."
        )

    dd, mm, nnn, blk, yy, vv = parts

    # Field 1: 2-digit day 01-31
    if not dd.isdigit() or len(dd) != 2:
        raise ValidationError(
            f"Field 1 (day) must be a 2-digit number (01-31), got '{dd}'."
        )
    day_int = int(dd)
    if day_int < 1 or day_int > 31:
        raise ValidationError(
            f"Field 1 (day) must be between 01 and 31, got '{dd}'."
        )

    # Field 2: month abbreviation
    if mm not in _VALID_MONTHS:
        raise ValidationError(
            f"Field 2 (month) must be one of {sorted(_VALID_MONTHS)}, got '{mm}'."
        )

    # Field 3: 1-4 digit sequence number
    if not nnn.isdigit() or not (1 <= len(nnn) <= 4):
        raise ValidationError(
            f"Field 3 (sequence) must be 1-4 digits, got '{nnn}'."
        )

    # Field 4: 1-3 alphanumeric block code
    if not blk.isalnum() or not (1 <= len(blk) <= 3):
        raise ValidationError(
            f"Field 4 (block) must be 1-3 alphanumeric characters, got '{blk}'."
        )

    # Field 5: 2-digit year
    if not yy.isdigit() or len(yy) != 2:
        raise ValidationError(
            f"Field 5 (year) must be a 2-digit number, got '{yy}'."
        )

    # Field 6: variety code — '--' or empty means "unknown at draft time" (allowed)
    if vv in ('--', ''):
        return

    # Lazy import to avoid circular imports at module load time.
    from django.apps import apps
    TomatoVariety = apps.get_model('core', 'TomatoVariety')
    if not TomatoVariety.objects.filter(code=vv).exists():
        raise ValidationError(
            f"Field 6 (variety code) '{vv}' does not match any registered variety code."
        )
