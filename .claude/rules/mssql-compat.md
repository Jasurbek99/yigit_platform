# MSSQL Compatibility Rules

These rules apply to ALL Python/Django code. Violations break production.

## Forbidden patterns (NEVER use)
- `models.JSONField` → use related table or separate model fields
- `models.ArrayField` → use ManyToManyField or comma-separated CharField
- `.distinct('field_name')` (DISTINCT ON) → use subquery with `ROW_NUMBER()`
- `bulk_create()` without `batch_size` → always set `batch_size=500`
- `TextField()` without `db_collation` for Turkmen/Russian content

## Required patterns (ALWAYS use)
- `db_collation='Cyrillic_General_CI_AS'` on CharField/TextField with Cyrillic text
- `DecimalField(max_digits=12, decimal_places=2)` for money and weight (never FloatField)
- `CharField(max_length=N)` — max_length is REQUIRED, no implicit max
- `on_delete=models.PROTECT` for reference ForeignKeys (firms, countries, status types)
- Explicit `batch_size=500` on every `bulk_create()` and `bulk_update()` call

## DISTINCT ON workaround
```python
# Instead of: Shipment.objects.distinct('export_firm')
from django.db.models import Subquery, OuterRef, Window
from django.db.models.functions import RowNumber

subquery = Shipment.objects.filter(
    export_firm=OuterRef('export_firm')
).order_by('-created_at').values('id')[:1]

Shipment.objects.filter(id__in=Subquery(subquery))
```
