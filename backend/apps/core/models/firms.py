from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class ExportFirm(models.Model):
    """YGT export companies (legal entities for customs documents)."""

    code = models.CharField(max_length=20, unique=True)
    name_tk = models.CharField(max_length=200, **cyrillic_collation())
    name_ru = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    name_en = models.CharField(max_length=200, blank=True, null=True)
    address_tk = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    address_ru = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    address_en = models.CharField(max_length=500, blank=True, null=True)
    bank_details_tk = models.CharField(max_length=1000, blank=True, null=True, **cyrillic_collation())
    bank_details_ru = models.CharField(max_length=1000, blank=True, null=True, **cyrillic_collation())
    bank_details_en = models.CharField(max_length=1000, blank=True, null=True)
    director = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    tax_code = models.CharField(max_length=50, blank=True, null=True)
    swift_code = models.CharField(max_length=20, blank=True, null=True)
    one_c_code = models.CharField(max_length=50, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_gapy_satys = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('core', 'export_firms')
        ordering = ['code']

    def __str__(self) -> str:
        return f'{self.code} — {self.name_en or self.name_tk}'


class ImportFirm(models.Model):
    """Buyer / importer companies."""

    code = models.CharField(max_length=50, blank=True, null=True)
    name_company = models.CharField(max_length=300, **cyrillic_collation())
    name_short = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    country = models.ForeignKey('core.Country', on_delete=models.PROTECT, null=True, blank=True)
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, null=True, blank=True)
    address = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    bank_details = models.CharField(max_length=1000, blank=True, null=True, **cyrillic_collation())
    contact_person = models.CharField(max_length=200, blank=True, null=True, **cyrillic_collation())
    phone = models.CharField(max_length=50, blank=True, null=True)
    director_signature = models.FileField(upload_to='import_firms/signatures/', null=True, blank=True)
    director_seal = models.FileField(upload_to='import_firms/seals/', null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_gapy_satys = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('core', 'import_firms')
        ordering = ['name_company']

    def __str__(self) -> str:
        return self.name_short or self.name_company


class Customer(models.Model):
    """Individual buyer/customer (person, not company)."""

    name = models.CharField(max_length=100, unique=True, **cyrillic_collation())
    phone = models.CharField(max_length=50, blank=True, null=True)
    default_country = models.ForeignKey(
        'core.Country',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='+',
    )
    default_city = models.ForeignKey(
        'core.City',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='+',
    )
    import_firms = models.ManyToManyField(
        'core.ImportFirm',
        blank=True,
        related_name='customers',
        db_table=schema_table('core', 'customer_import_firms'),
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'customers')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class DomesticBuyer(models.Model):
    """Domestic TM buyers who purchase tomatoes directly from the greenhouse.

    Used in export.domestic_sales to track quota-forming daily purchases
    per block. DDL: core.domestic_buyers
    """

    name = models.CharField(max_length=100, unique=True, **cyrillic_collation())
    contact_person = models.CharField(
        max_length=100, blank=True, null=True, **cyrillic_collation()
    )
    phone = models.CharField(max_length=50, blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('core', 'domestic_buyers')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name
