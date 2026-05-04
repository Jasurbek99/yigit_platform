"""Sheet Control v2 models — per-row configuration for the Shipment Sheet.

Models:
  SheetRowSetting        — per-row display/permission config (v2 extended)
  SheetRowRoleTrigger    — multi-role triggers (replaces single triggered_role)
  SheetRowUserPermission — extra-user grants (exception to lock)

ADRs:
  ADR-0008: No JSONField — split columns/child tables only
  ADR-0009: Additive migrations (0031/0032/0033)
  ADR-0010: is_locked explicit field, not inactive-user hack
  ADR-0001: extra_users are exceptions to lock, not in addition
  ADR-0002: Soft-delete everywhere — never hard-delete
  ADR-0006: Optimistic locking via version field
  ADR-0007: Sparse display_order (step 1024)
"""
import re

from django.db import models
from django.db.models import Q
from django.core.exceptions import ValidationError

from apps.core.models.user import ROLE_CHOICES

_HEX_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')

STYLE_ALIGN_CHOICES = [
    ('left', 'Left'),
    ('center', 'Center'),
    ('right', 'Right'),
]


class SheetRowSettingManager(models.Manager):
    """Custom manager exposing .active() and .visible() querysets.

    Always use .active() in application code. Raw .objects.all() is
    for admin tooling and migrations only.
    """

    def active(self):
        """Return rows that have not been soft-deleted."""
        return self.filter(deleted_at__isnull=True)

    def visible(self):
        """Return rows that are active AND marked visible."""
        return self.active().filter(is_visible=True)


class SheetRowSetting(models.Model):
    """Per-row configuration for the shipment Sheet view (Sheet Control v2).

    Controls display order, visibility, lock state, localized labels/descriptions,
    style, and permission triggers for each row in the Shipment Sheet.

    Identity:
      ``field_key`` is the canonical immutable identifier — it matches values
      in DEFAULT_SHEET_ROWS and serializer field names. Never change it after
      creation.

    Permission model (ADR-0001, ADR-0010):
      - is_locked=False → triggered_user/roles/extra_users each independently
        grant edit access (AND with field perm).
      - is_locked=True  → only users in role_triggers or user_permissions
        (can_edit=True, not soft-deleted) may edit. Superuser/admin/director
        always bypass.

    Concurrency (ADR-0006):
      ``version`` is incremented on every save(). PATCH endpoints must supply
      the current version; mismatch → 409 Conflict.

    Soft-delete (ADR-0002):
      ``deleted_at`` / ``deleted_by`` mark deletion. Use objects.active()
      for all application queries.

    Display order (ADR-0007):
      Sparse integers starting at 1024 with step 1024. Drag-reorder updates
      a single row's display_order. Rebalance happens only when gap < 2.

    DDL: export_sheet_row_setting (no SQL schema prefix — platform table)
    """

    # === Identity (immutable after creation) ===
    field_key = models.CharField(
        max_length=60,
        unique=True,
        help_text='Matches field_key in DEFAULT_SHEET_ROWS. Immutable after creation.',
    )

    # === Legacy ordinal (preserved for migration compatibility) ===
    row_number = models.PositiveSmallIntegerField(
        help_text='Original display ordinal from DEFAULT_SHEET_ROWS. Superseded by display_order.',
    )

    # === Display (Tier 1 — runtime config, changed via admin UI) ===
    display_order = models.PositiveIntegerField(
        default=0,
        db_index=True,
        help_text='Sparse integer (step 1024). Controls row order in Sheet view.',
    )
    is_visible = models.BooleanField(
        default=True,
        help_text='Hidden rows are excluded from the /sheet/ payload entirely.',
    )
    is_locked = models.BooleanField(
        default=False,
        help_text=(
            'When True, only users in role_triggers or active user_permissions '
            'may edit. Superuser/admin/director bypass this lock always.'
        ),
    )

    # === Localized labels (ADR-0008: split columns, not JSONField) ===
    label_tk = models.CharField(
        max_length=120,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='Row label in Turkmen. Fallback: i18n file → field_key raw.',
    )
    label_ru = models.CharField(
        max_length=120,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='Row label in Russian.',
    )
    label_en = models.CharField(
        max_length=120,
        blank=True,
        help_text='Row label in English.',
    )

    # === Localized "Who" override (Phase 5a) ===
    # Per-row override of Col B (the "Who" / responsible-actor label). Falls
    # back to t(rowConfig.default_who_key) on the frontend when blank. Same
    # split-column shape as label_*; max_length is shorter because Col B is
    # narrow (a name or a role, not a sentence).
    who_tk = models.CharField(
        max_length=80,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='"Who" column override in Turkmen. Falls back to default_who_key i18n.',
    )
    who_ru = models.CharField(
        max_length=80,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='"Who" column override in Russian.',
    )
    who_en = models.CharField(
        max_length=80,
        blank=True,
        help_text='"Who" column override in English.',
    )

    # === Localized descriptions / tooltips ===
    description_tk = models.CharField(
        max_length=255,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='Tooltip description in Turkmen.',
    )
    description_ru = models.CharField(
        max_length=255,
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        help_text='Tooltip description in Russian.',
    )
    description_en = models.CharField(
        max_length=255,
        blank=True,
        help_text='Tooltip description in English.',
    )

    # === Style (ADR-0008: split columns) ===
    style_width = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text='Column width in pixels. Valid range: 50–500.',
    )
    style_align = models.CharField(
        max_length=8,
        choices=STYLE_ALIGN_CHOICES,
        blank=True,
        help_text="Text alignment: 'left', 'center', or 'right'.",
    )
    style_color = models.CharField(
        max_length=7,
        blank=True,
        help_text='Background colour as #RRGGBB hex string.',
    )

    # === Permission trigger — single user exception ===
    triggered_user = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='sheet_rows_triggered',
        help_text=(
            'When set, this specific user has edit rights (if active). '
            'Semantics changed from v1: this is now an exception grant, '
            'not a lock. Inactive user treated as if not set (ADR-0010).'
        ),
    )

    # === Concurrency (ADR-0006) ===
    version = models.PositiveIntegerField(
        default=1,
        help_text='Incremented on every save(). Used for optimistic locking in PATCH.',
    )

    # === Soft-delete (ADR-0002) ===
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Set to now() on soft-delete. Null = active.',
    )
    deleted_by = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
        help_text='User who soft-deleted this row.',
    )

    # === Hide cooldown (Phase 1 reviewer note #5) ===
    # `hidden_at` is set when is_visible flips from True → False, cleared
    # when it flips back. The 30-day soft-delete cooldown reads this column
    # rather than `updated_at`, so cosmetic edits (label changes etc.) do
    # NOT reset the clock.
    hidden_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Timestamp of the most recent is_visible=False transition. '
                  'Null when is_visible=True (or never hidden).',
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

    objects = SheetRowSettingManager()

    class Meta:
        db_table = 'export_sheet_row_setting'
        ordering = ['display_order']

    def clean(self) -> None:
        """Validate style fields."""
        errors = {}

        if self.style_width is not None:
            if not (50 <= self.style_width <= 500):
                errors['style_width'] = 'style_width must be between 50 and 500 pixels.'

        if self.style_color:
            if not _HEX_RE.match(self.style_color):
                errors['style_color'] = 'style_color must be a valid #RRGGBB hex string.'

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs) -> None:
        """Increment version on every update (not on insert).

        Also tracks is_visible transitions in `hidden_at`:
          - True  → False : set hidden_at = now()
          - False → True  : clear hidden_at to None
        Cosmetic edits (labels, style, etc.) leave hidden_at alone, so the
        30-day soft-delete cooldown reads the real "hidden since" timestamp.
        """
        if self.pk is not None:
            self.version += 1
            # Read the previous is_visible state from the DB exactly once.
            try:
                prev_visible = (
                    type(self).objects.filter(pk=self.pk)
                    .values_list('is_visible', flat=True)
                    .first()
                )
            except Exception:
                prev_visible = None
            if prev_visible is True and self.is_visible is False:
                from django.utils import timezone
                self.hidden_at = timezone.now()
            elif prev_visible is False and self.is_visible is True:
                self.hidden_at = None
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f'R{self.row_number} {self.field_key}'


class SheetRowRoleTrigger(models.Model):
    """Role-level edit trigger for a SheetRowSetting.

    Replaces the single triggered_role CharField (v1) with a proper
    child table supporting multiple roles per row.

    When is_locked=True, matching users in these roles may edit (exception
    to lock per ADR-0001). When is_locked=False, matching users gain edit
    access (AND with field perm).

    DDL: export_sheet_row_role_trigger
    """

    row = models.ForeignKey(
        SheetRowSetting,
        on_delete=models.CASCADE,
        related_name='role_triggers',
    )
    role = models.CharField(
        max_length=30,
        choices=ROLE_CHOICES,
    )

    class Meta:
        db_table = 'export_sheet_row_role_trigger'
        constraints = [
            models.UniqueConstraint(
                fields=['row', 'role'],
                name='uq_sheet_row_role',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.row.field_key} → {self.role}'


class SheetRowUserPermission(models.Model):
    """Per-user extra grant for a SheetRowSetting.

    When is_locked=True, users listed here with can_edit=True are exceptions
    to the lock (ADR-0001). When is_locked=False, they gain regular edit access.

    Soft-deleted entries (deleted_at set) are ignored by permission checks.
    User FK uses SET_NULL so history is preserved when a user account is
    deleted (ADR-0002). The partial UniqueConstraint prevents duplicate active
    grants but allows multiple soft-deleted rows (MSSQL filtered index).

    DDL: export_sheet_row_user_permission
    """

    row = models.ForeignKey(
        SheetRowSetting,
        on_delete=models.CASCADE,
        related_name='user_permissions',
    )
    user = models.ForeignKey(
        'core.User',
        null=True,
        on_delete=models.SET_NULL,
        related_name='sheet_row_permissions',
        help_text='SET_NULL on user deletion to preserve history (ADR-0002).',
    )
    can_edit = models.BooleanField(
        default=True,
        help_text='When False, this is a read-only grant (reserved for future use).',
    )

    # === Soft-delete (ADR-0002) ===
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )

    # === Audit ===
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        'core.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )

    class Meta:
        db_table = 'export_sheet_row_user_permission'
        constraints = [
            models.UniqueConstraint(
                fields=['row', 'user'],
                condition=Q(deleted_at__isnull=True),
                name='uq_active_row_user',
            ),
        ]

    def __str__(self) -> str:
        user_str = str(self.user) if self.user_id else 'deleted_user'
        return f'{self.row.field_key} → {user_str} (can_edit={self.can_edit})'


class UserSheetRowPref(models.Model):
    """Per-user override for SheetRowSetting display order and visibility.

    Replaces the JSONField-based row_order/hidden_rows plan field per ADR-0008
    (MSSQL forbids JSONField). One row per (user, sheet_row) pair when the user
    has a non-default preference. Absent = inherit admin defaults.

    position semantics:
      - NULL  → use admin display_order for ordering (user hasn't reordered this row)
      - N     → user's explicit position, sparse integer (step 1024)

    is_hidden semantics:
      - False → not hidden by user (default)
      - True  → user has hidden this row; AND-composes with admin is_visible

    A pref row is created only when the user expresses a preference (hide or
    reorder). Rows absent from this table inherit admin defaults, keeping the
    table small for users who never customise.

    Note: rows are not deleted when a preference reverts to default (position→NULL,
    is_hidden→False) to avoid the race between simultaneous PATCH requests. A
    separate cleanup pass (not in scope for v1) can prune no-op rows.

    DDL: export_user_sheet_row_pref
    """

    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        related_name='sheet_row_prefs',
    )
    row = models.ForeignKey(
        SheetRowSetting,
        on_delete=models.CASCADE,
        related_name='user_prefs',
    )
    # Per-user position. Sparse integer (step 1024) like SheetRowSetting.display_order.
    # Null means "use admin display_order". This lets a user hide-without-reorder
    # without having to pick a position for every other row.
    position = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Per-user display position (sparse). Null inherits admin display_order.',
    )
    is_hidden = models.BooleanField(
        default=False,
        help_text='User-side row hide. AND-composes with admin is_visible.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'export_user_sheet_row_pref'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'row'],
                name='uq_user_sheet_row_pref',
            ),
        ]

    def __str__(self) -> str:
        return (
            f'user={self.user_id} row={self.row_id} '
            f'position={self.position} is_hidden={self.is_hidden}'
        )
