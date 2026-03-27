---
name: django-model
description: "Create Django models matching DDL v5.1 for the YGT Platform. Use when creating or modifying models."
---

# Django Model Skill (MSSQL + DDL v5.1)

## Template

```python
from django.db import models
from django.core.validators import MinValueValidator


class Shipment(models.Model):
    """Export shipment record. Maps to export.shipments in DDL v5.1."""
    
    # === Identifiers ===
    code = models.CharField(max_length=20, unique=True)  # cargo code DDMM###/YY, Latin only — no collation
    date = models.DateField()
    season = models.ForeignKey('core.Season', on_delete=models.PROTECT)
    
    # === Destination (city can be NULL — decided late) ===
    country = models.ForeignKey('core.Country', on_delete=models.PROTECT, null=True, blank=True)
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, null=True, blank=True)
    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, null=True, blank=True)
    import_firm = models.ForeignKey('core.ImportFirm', on_delete=models.PROTECT, null=True, blank=True)
    
    # === Weight (DecimalField, never FloatField) ===
    weight_gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True)
    weight_net_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True)
    box_count = models.IntegerField(null=True)
    
    # === Vehicle (FKs to Trip Management — external DB, BIGINT only, no Django FK) ===
    truck_head_id = models.BigIntegerField(null=True, blank=True)
    trailer_id = models.BigIntegerField(null=True, blank=True)
    driver_id = models.BigIntegerField(null=True, blank=True)
    
    # === Status ===
    status = models.ForeignKey('core.ShipmentStatusType', on_delete=models.PROTECT)
    
    # === AD-1: Denormalized timestamps (written ONLY by transition_to) ===
    loading_started_at = models.DateTimeField(null=True, blank=True)
    departed_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    # ... other timestamp columns per AD-1
    
    # === AD-2: Structured vehicle fields (replaces R15) ===
    vehicle_condition = models.CharField(max_length=20, null=True, blank=True)  # OK/ISSUE/BREAKDOWN/RETURNED
    vehicle_condition_note = models.CharField(max_length=300, blank=True, default='',
                                               db_collation='Cyrillic_General_CI_AS')
    route_note = models.CharField(max_length=300, blank=True, default='',
                                   db_collation='Cyrillic_General_CI_AS')
    
    # === Audit ===
    created_by = models.ForeignKey('sys_users', on_delete=models.PROTECT, related_name='+', null=True)
    updated_by = models.ForeignKey('sys_users', on_delete=models.PROTECT, related_name='+', null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'export.shipments'
        ordering = ['-date', '-id']
    
    def __str__(self):
        return self.code
```

## Key rules
- `db_table` must match DDL v5.1 exactly: `'schema.tablename'`
- `db_collation='Cyrillic_General_CI_AS'` ONLY on Turkmen/Russian text fields
- Trip Management FKs: `BigIntegerField` not `ForeignKey` (external DB)
- Cross-app FKs: string references `'core.ExportFirm'`
- Money/weight: `DecimalField(max_digits=12, decimal_places=2)`, never `FloatField`
- If `models/` package: add to `__init__.py` re-exports
