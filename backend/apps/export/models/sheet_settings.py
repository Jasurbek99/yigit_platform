from django.db import models
from django.db.models import Q

from apps.core.models.user import ROLE_CHOICES


class SheetRowSetting(models.Model):
    """Per-row configuration for the shipment Sheet view.

    Controls which role or specific user is the "triggered" actor for a given
    row. At most one of ``triggered_role`` and ``triggered_user`` may be set at
    a time (XOR, enforced via DB CheckConstraint). When neither is set, edit
    gating falls back to the standard ``RoleFieldPermission`` check.

    ``field_key`` is the canonical identifier — it matches the ``field_key``
    values in ``DEFAULT_SHEET_ROWS`` and serializer field names. The default
    Django ``id`` PK is preserved so that ``AuditLog.object_id`` (IntegerField)
    can reference this table without schema changes.

    Known constraint: ``triggered_role`` uses ``blank=True, default=''`` which
    allows storing an empty string (meaning "not set"). The empty string is NOT
    in ROLE_CHOICES, so ``Model.full_clean()`` will raise if called with
    triggered_role=''. No existing code path calls full_clean() on this model;
    if that changes, add ('', '') to a local choices list or rely solely on
    serializer-level validation.

    DDL: export_sheet_row_setting (new platform table — no SQL schema prefix)
    """

    # === Identifier ===
    field_key = models.CharField(
        max_length=60,
        unique=True,
        db_index=True,
        help_text='Matches field_key in DEFAULT_SHEET_ROWS and serializer field names.',
    )

    # === Display ordinal ===
    row_number = models.PositiveSmallIntegerField(
        db_index=True,
        help_text='Display ordinal from DEFAULT_SHEET_ROWS. Informational only.',
    )

    # === Trigger config (role XOR user) ===
    triggered_role = models.CharField(
        max_length=30,
        choices=ROLE_CHOICES,
        blank=True,
        default='',
        help_text='If set, only users with this role may edit this row (AND must have field perm).',
    )
    triggered_user = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='sheet_rows_triggered',
        help_text='If set, only this specific user may edit this row (AND must have field perm). '
                  'Inactive user locks the row for everyone.',
    )

    # === Audit ===
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )

    class Meta:
        db_table = 'export_sheet_row_setting'
        constraints = [
            models.CheckConstraint(
                check=~(Q(triggered_role__gt='') & Q(triggered_user__isnull=False)),
                name='sheet_row_setting_role_xor_user',
            ),
        ]

    def __str__(self) -> str:
        return f'R{self.row_number} {self.field_key}'
