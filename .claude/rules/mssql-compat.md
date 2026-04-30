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

## Window functions inside `Subquery()` — strip Meta.ordering
MSSQL rejects an `ORDER BY` inside a derived table / subquery / CTE unless `TOP`, `OFFSET`, or `FOR XML` is also present. When a model has `Meta.ordering`, every queryset built from it inherits an outer `ORDER BY`. Wrap that queryset in `Subquery(...)` and the outer `ORDER BY` lands in a forbidden position — MSSQL 500s with `[42000] (1033) (8180)`. SQLite tolerates it, so this fails silently in tests and only blows up in production.

**Always call `.order_by()` (no args) on the inner queryset before wrapping it in `Subquery()` if the queryset uses a Window or doesn't explicitly need outer ordering:**

```python
# WRONG — AuditLog.Meta.ordering = ['-created_at'] propagates outward,
# MSSQL rejects the resulting subquery
ranked = AuditLog.objects.filter(...).annotate(
    rn=Window(
        expression=RowNumber(),
        partition_by=[F('object_id'), F('field_name')],
        order_by=F('created_at').desc(),  # this OVER(...) ORDER BY is fine
    ),
)
AuditLog.objects.filter(pk__in=Subquery(ranked.filter(rn=1).values('pk')))

# RIGHT — strip the inherited Meta.ordering before subquery wrapping.
# The Window's internal OVER(... ORDER BY ...) is unaffected.
ranked = AuditLog.objects.filter(...).annotate(
    rn=Window(
        expression=RowNumber(),
        partition_by=[F('object_id'), F('field_name')],
        order_by=F('created_at').desc(),
    ),
).order_by()  # ← strip Meta.ordering
AuditLog.objects.filter(pk__in=Subquery(ranked.filter(rn=1).values('pk')))
```

The same rule applies to any `.order_by()`-aware queryset placed inside `Subquery()`: if you don't need that outer ordering for the subquery's semantics (e.g. you're just filtering by `pk__in`), strip it.
