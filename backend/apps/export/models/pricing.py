from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class PriceEntry(models.Model):
    """Market tomato price per city per day.

    DDL: export.price_entries — UNIQUE (date, city_id)
    Used by the PricePanel 7-day trend view.
    """

    date = models.DateField()
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, db_column='city_id')
    price_local = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_usd = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=10, blank=True, default='')
    source = models.CharField(max_length=30, blank=True, default='')
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='price_entries_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'price_entries')
        constraints = [
            models.UniqueConstraint(fields=['date', 'city'], name='uq_price_date_city')
        ]
        ordering = ['-date', 'city']


class DomesticMarketPrice(models.Model):
    """Domestic Turkmenistan market prices from the Satys_bahalar Excel file.

    Tracks daily tomato/vegetable prices at named bazaars (Tolkuçka, Teke bazar, etc.)
    split by price type (bazar/klent/online) and variety. Used to compare
    local TM prices against export destination prices.

    DDL: export.domestic_market_prices
    No unique constraint in DDL — an index covers (date, market_name, price_type, variety_type)
    for fast range queries.
    """

    # === When & where ===
    date = models.DateField()
    market_name = models.CharField(max_length=100, **cyrillic_collation())

    # === Classification ===
    # price_type: 'bazar', 'klent', 'online' — Latin-only codes, no collation needed
    price_type = models.CharField(max_length=30, blank=True, null=True)
    # variety_type: 'tomato_gulpakly', 'tomato_cherry', 'pepper_round', etc.
    variety_type = models.CharField(max_length=30, blank=True, null=True)

    # === Price (TMT per kg) ===
    price = models.DecimalField(max_digits=8, decimal_places=2)

    # === Audit ===
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='domestic_prices_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'domestic_market_prices')
        # Mirror the DDL index for fast date-range queries by market/type/variety
        indexes = [
            models.Index(
                fields=['date', 'market_name', 'price_type', 'variety_type'],
                name='ix_domestic_price',
            )
        ]
        ordering = ['-date', 'market_name']

    def __str__(self) -> str:
        return f'{self.date} | {self.market_name} | {self.variety_type} — {self.price} TMT/kg'
