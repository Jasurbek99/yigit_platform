from django.core.validators import MaxValueValidator
from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class GreenhouseBlock(models.Model):
    """Greenhouse blocks A–O, plus inner sub-blocks (e.g. OD, OG under O).

    parent is NULL for top-level blocks; set for inner sub-blocks.
    """

    code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    parent = models.ForeignKey(
        'self',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sub_blocks',
        db_column='parent_id',
    )
    manager = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_blocks_set',
    )
    variety_main = models.ForeignKey(
        'core.TomatoVariety',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='primary_blocks',
        db_column='variety_main_id',
    )
    variety_secondary = models.ForeignKey(
        'core.TomatoVariety',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='secondary_blocks',
        db_column='variety_secondary_id',
    )
    area_m2 = models.IntegerField(blank=True, null=True)
    location = models.ForeignKey(
        'core.LoadingLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='blocks',
        db_column='location_id',
    )
    section_count = models.IntegerField(blank=True, null=True)
    sowing_date = models.DateField(blank=True, null=True)
    season_start_month = models.IntegerField(blank=True, null=True)
    color = models.CharField(max_length=7, blank=True, null=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # How many days a leftover from this block stays loadable. Blocks with cold
    # storage hold tomatoes for days; blocks without do not. Replaces the single
    # GreenhouseConfig.gaplama_carry_days, which applied 2 days to everything
    # (owner report 2026-09-24). Everyone starts at 7 and is tuned later.
    # Capped at 30 (2026-09-25): build_gaplama_board sizes its walk window at
    # 2 x max(carry_days) ACROSS EVERY BLOCK, and each block's own bucket
    # list inside that window is bounded by its own carry_days — cost is
    # quadratic in this value, and the walk window is shared by the whole
    # roster, so one block's mistake slows the board for everyone. 30 days
    # is already generous for a fresh tomato even under cold storage (real
    # operators run 2-3 weeks); it bounds the worst case to a ~60-day walk
    # with ~30-entry bucket lists, trivial either way, instead of a typo
    # like 3650 walking two decades for every block on every request.
    carry_days = models.PositiveSmallIntegerField(default=7, validators=[MaxValueValidator(30)])

    class Meta:
        db_table = schema_table('core', 'greenhouse_blocks')
        ordering = ['sort_order', 'code']

    def __str__(self) -> str:
        return f'{self.code} — {self.name or ""}'
