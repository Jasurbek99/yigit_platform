from django.db import models
from apps.core.db_utils import schema_table, cyrillic_collation


class DomesticSale(models.Model):
    """Daily domestic tomato sale record per buyer per block.

    Tracks kg sold locally within Turkmenistan (not exported). Used to
    form quota-related data and compare against export volumes.

    DDL: export.domestic_sales
    """

    # === When & who ===
    date = models.DateField()
    buyer = models.ForeignKey(
        'core.DomesticBuyer', on_delete=models.PROTECT,
        db_column='buyer_id', related_name='domestic_sales',
    )

    # === Where ===
    block = models.ForeignKey(
        'core.GreenhouseBlock', on_delete=models.PROTECT,
        db_column='block_id', related_name='domestic_sales',
    )
    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT,
        null=True, blank=True,
        db_column='export_firm_id',
    )

    # === Volume & price ===
    weight_kg = models.DecimalField(max_digits=10, decimal_places=2)
    variety = models.CharField(max_length=50, blank=True, null=True, **cyrillic_collation())
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    # === Reference ===
    tabel_no = models.CharField(max_length=20, blank=True, null=True)
    notes = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='created_by', related_name='domestic_sales_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'domestic_sales')
        ordering = ['-date', '-id']

    def __str__(self) -> str:
        return f'{self.date} | {self.buyer_id} | {self.weight_kg} kg'
