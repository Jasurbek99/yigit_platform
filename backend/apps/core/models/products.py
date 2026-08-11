from django.core.exceptions import ValidationError
from django.db import models

from apps.core.db_utils import schema_table


class Season(models.Model):
    """Export season (e.g. 2025-2026).

    State is derived from `is_active` + `closed_at`, never stored separately:

      UPCOMING  closed_at is NULL and is_active is False — created, not opened
      ACTIVE    is_active is True — the write target; exactly one at a time
      CLOSED    closed_at is not NULL — frozen and hidden

    `is_active` is the *write target* only. The *read scope* is resolved
    per-request by `apps.core.seasons.resolve_season()`.
    """

    STATUS_UPCOMING = 'UPCOMING'
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_CLOSED = 'CLOSED'

    name = models.CharField(max_length=10, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    # === Close lifecycle ===
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='closed_seasons',
    )

    class Meta:
        db_table = schema_table('core', 'seasons')
        ordering = ['-start_date']
        constraints = [
            # Filtered unique index — at most one row may have is_active=True.
            # mssql-django emits this as a filtered index; the same pattern is
            # already in production (contracts/models/contract.py:155).
            models.UniqueConstraint(
                fields=['is_active'],
                condition=models.Q(is_active=True),
                name='uq_season_single_active',
            ),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def status(self) -> str:
        """Derived lifecycle state. `closed_at` is authoritative."""
        if self.closed_at is not None:
            return self.STATUS_CLOSED
        if self.is_active:
            return self.STATUS_ACTIVE
        return self.STATUS_UPCOMING

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None

    def assert_activation_allowed(self) -> None:
        """Refuse an `is_active=True` write on a closed season.

        Reopening a closed season is unsupported by design (`open_season()`
        in `apps.core.services.season` already refuses it) — this is the
        single predicate both that service's callers and every other write
        path (Django admin, a raw ORM `.save()`, a management command) must
        satisfy, called from `save()` below and reused by
        `SeasonSerializer.validate_is_active()` at the API boundary.

        The API boundary needs that copy because `is_active` is writable again
        (2026-08-10, the admin form's Active switch): without it the request
        would reach `open_season()`, whose `ValueError` the generic `update()`
        does not translate, and this method's own
        `django.core.exceptions.ValidationError` is not translated by the
        custom exception handler either — both surface as a raw 500 instead of
        a 400.

        `close_season()`/`open_season()` never trip this: `close_season()`
        always writes `is_active=False`, and `open_season()` raises before
        ever setting `is_active=True` on a season that is already closed.

        Raises:
            ValidationError: If `is_active` is True and `closed_at` is set.
        """
        if self.is_active and self.closed_at is not None:
            raise ValidationError(
                f'Season {self.name!r} is closed and cannot be reactivated.'
            )

    def save(self, *args, **kwargs) -> None:
        """Persist the row, enforcing `assert_activation_allowed()` first."""
        self.assert_activation_allowed()
        super().save(*args, **kwargs)


class TomatoVariety(models.Model):
    """Tomato cultivar reference.

    Official variety codes (01-10) and experimental codes (E1-E3) are assigned
    by the signed 15.04.2026 departmental document. code=None means legacy
    row not yet mapped to the official registry.
    """

    name = models.CharField(max_length=50, unique=True)
    code = models.CharField(max_length=5, unique=True, null=True, blank=True)
    is_experimental = models.BooleanField(default=False)
    scientific_name = models.CharField(max_length=50, blank=True)
    type = models.CharField(max_length=30, blank=True, null=True)
    avg_fruit_weight_gr = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)
    color = models.CharField(max_length=7, blank=True, null=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = schema_table('core', 'tomato_varieties')
        ordering = ['sort_order', 'name']
        verbose_name_plural = 'Tomato varieties'

    def __str__(self) -> str:
        return self.name


class ProductType(models.Model):
    """Product types (Pomidor, Bolgar burç, etc.)."""

    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = schema_table('core', 'product_types')

    def __str__(self) -> str:
        return self.name
