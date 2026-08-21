"""DocumentLayoutSetting — per-document-type page-layout adjustments.

Lets the office make a contract fit one page without a developer editing the
``.docx`` template and redeploying. Ported from sera-butce-web, whose print view
carries live sliders for font size, line spacing and margins.

**Adjustments, not absolutes.** Every field is a delta or a scale against the
template's own values, for two measured reasons:

* ``contract_kz.docx`` has two sections with deliberately different top margins
  (0.51cm on page 1 for the letterhead, 2.5cm after). A single absolute knob
  would flatten that; a delta preserves the difference.
* An absolute base font size is nearly a no-op, because most runs carry an
  explicit ``<w:sz>`` that overrides the Normal style (713 of 879 runs in
  ``contract_kz.docx``). Only a scale applied run-by-run actually moves the text,
  and it keeps each template's size hierarchy intact.

Flat typed columns with a ``version`` for optimistic locking, mirroring
``export.SheetRowSetting``. No JSONField — forbidden on MSSQL (ADR-0008).
"""
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.db_utils import schema_table

# Bounds. Deliberately narrow: these knobs nudge a legal document onto one page,
# they are not a layout editor. Anything outside this is a template change.
FONT_SCALE_MIN, FONT_SCALE_MAX = 80, 120
LINE_SPACING_MIN, LINE_SPACING_MAX = 1.0, 2.0
MARGIN_DELTA_MIN, MARGIN_DELTA_MAX = -10, 15


class DocumentLayoutSetting(models.Model):
    """Saved layout adjustments for one registry document key.

    One row per document type, shared by every user — the printed output of a
    legal document should not differ between operators.
    """

    # === Identity ===
    document_key = models.CharField(
        max_length=32,
        unique=True,
        help_text='Registry document key (e.g. invoice_ru). The four CMR keys are '
                  'rejected: their geometry registers onto a pre-printed form.',
    )

    # === Adjustments ===
    font_scale_pct = models.PositiveSmallIntegerField(
        default=100,
        help_text=f'Scales every run\'s font size. {FONT_SCALE_MIN}-{FONT_SCALE_MAX}; '
                  '100 = the template unchanged.',
    )
    line_spacing = models.DecimalField(
        max_digits=3, decimal_places=2, null=True, blank=True,
        help_text=f'Line spacing multiple, {LINE_SPACING_MIN}-{LINE_SPACING_MAX}. '
                  'Null = leave the template alone.',
    )
    margin_top_delta_mm = models.SmallIntegerField(default=0)
    margin_bottom_delta_mm = models.SmallIntegerField(default=0)
    margin_left_delta_mm = models.SmallIntegerField(default=0)
    margin_right_delta_mm = models.SmallIntegerField(default=0)

    # === Concurrency (ADR-0006) ===
    version = models.PositiveIntegerField(
        default=1,
        help_text='Incremented on every save(). Used for optimistic locking in PATCH.',
    )

    # === Audit ===
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )

    class Meta:
        db_table = schema_table('contracts', 'document_layout_setting')
        ordering = ['document_key']

    def __str__(self) -> str:
        return f'{self.document_key} ({self.font_scale_pct}%)'

    @property
    def margin_deltas_mm(self) -> dict[str, int]:
        """The four margin deltas keyed by python-docx section attribute name."""
        return {
            'top_margin': self.margin_top_delta_mm,
            'bottom_margin': self.margin_bottom_delta_mm,
            'left_margin': self.margin_left_delta_mm,
            'right_margin': self.margin_right_delta_mm,
        }

    @property
    def is_default(self) -> bool:
        """True when this row would not change the template at all."""
        return (
            self.font_scale_pct == 100
            and self.line_spacing is None
            and not any(self.margin_deltas_mm.values())
        )

    def clean(self) -> None:
        """Validate the adjustment ranges."""
        errors = {}

        if not (FONT_SCALE_MIN <= self.font_scale_pct <= FONT_SCALE_MAX):
            errors['font_scale_pct'] = (
                f'font_scale_pct must be between {FONT_SCALE_MIN} and {FONT_SCALE_MAX}.'
            )

        if self.line_spacing is not None:
            if not (LINE_SPACING_MIN <= float(self.line_spacing) <= LINE_SPACING_MAX):
                errors['line_spacing'] = (
                    f'line_spacing must be between {LINE_SPACING_MIN} and {LINE_SPACING_MAX}.'
                )

        for field, value in (
            ('margin_top_delta_mm', self.margin_top_delta_mm),
            ('margin_bottom_delta_mm', self.margin_bottom_delta_mm),
            ('margin_left_delta_mm', self.margin_left_delta_mm),
            ('margin_right_delta_mm', self.margin_right_delta_mm),
        ):
            if not (MARGIN_DELTA_MIN <= value <= MARGIN_DELTA_MAX):
                errors[field] = (
                    f'{field} must be between {MARGIN_DELTA_MIN} and {MARGIN_DELTA_MAX} mm.'
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Bump ``version`` on every write, for optimistic locking."""
        if self.pk:
            self.version = (self.version or 0) + 1
        super().save(*args, **kwargs)
