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

    class Meta:
        db_table = schema_table('core', 'greenhouse_blocks')
        ordering = ['sort_order', 'code']

    def __str__(self) -> str:
        return f'{self.code} — {self.name or ""}'
