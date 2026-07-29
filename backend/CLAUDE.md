# Backend rules — Django / MSSQL

Loaded when working with files under `backend/`.
Always-loaded rules live in the root `CLAUDE.md`; MSSQL forbidden patterns live in `.claude/rules/mssql-compat.md`.

---

# Architecture Rules

## Module dependency direction (STRICT)
```
core → greenhouse → export → contracts → finance
                           ↘ transport ↗
```
- `core/` is imported by ALL other apps. Never import from greenhouse/export/contracts/etc.
- `greenhouse/` can import from `core/`. Never from `export/` or downstream. (Temporary exception: `Notification`/`AuditLog` imports from `export` until those move to `core`.)
- `export/` can import from `core/` and `greenhouse/`. Never from `contracts/` or `finance/`.
- `contracts/` can import from `core/`, `greenhouse/`, and `export/`. Never from `finance/`.
- `finance/` can import from all upstream apps.
- `transport/` can import from `core/` and `export/`.
- **Circular imports = architectural bug. Fix immediately.**

## core/ app rules
- Contains ONLY shared reference models: User, ExportFirm, ImportFirm, Customer, Country, City, GreenhouseBlock, TomatoVariety, Manager, LoadingLocation, BorderPoint, ShipmentStatusType
- Changes to core/ models affect ALL downstream modules — always check impact
- core/ models should be stable — add new ones rarely, modify existing ones even more rarely
- Use `PROTECT` on all ForeignKeys pointing to core/ models

## Business logic placement
- **In model methods**: status transitions, validation, calculated properties
- **In `services.py`**: complex multi-model operations, external API calls
- **In `serializers`**: data transformation, nested object assembly
- **NEVER in views**: views should only call serializers and services

## API-first design
- Every feature must have a REST API — the React frontend is just one consumer
- Future mobile CRM will use the same API
- All endpoints under `/api/v1/` with proper versioning
- Use DRF's content negotiation — JSON by default

## SQL safety (SQL injection prevention)

The runtime API is 100% Django ORM — the ORM parameterizes every query, so runtime code is injection-safe by construction. Keep it that way:

- **Runtime code (views / serializers / services / filters / model methods): ORM only.** No `.raw()`, `.extra()`, `RawSQL`, or `connection.cursor()` in the request path. If you think you need raw SQL in runtime code — stop and ask; there's almost always an ORM/`annotate`/`Subquery` equivalent.
- **Sorting / filtering from query params must use a whitelist**, never a column name pulled straight from the URL. Use DRF `OrderingFilter` (explicit `ordering_fields`) and `.filter(...)` with values — never build `.order_by(request.query_params['sort'])` or f-string a column name.
- **If raw SQL is ever unavoidable (management commands, migrations), values go through parameters — never string formatting:**
  ```python
  # RIGHT — value is a bind parameter
  cursor.execute("SELECT COUNT(*) FROM sys.identity_columns WHERE object_id = OBJECT_ID(%s)", [f'dbo.{table}'])

  # WRONG — user/dynamic value concatenated into SQL
  cursor.execute(f"SELECT * FROM export_shipment WHERE code = '{code}'")
  ```
  Only fixed **internal identifiers** (table names from a hardcoded map, like the migrate/dump-fk commands) may be interpolated with an f-string — never a value that could originate from a request. Table/column identifiers can't be parameterized with `%s`, so they must come from code constants, not input.

## Django modular app gotchas

### 1. models/ package requires __init__.py re-exports
When splitting `models.py` into a `models/` directory, Django's migration engine won't find your models unless you re-export them:
```python
# apps/export/models/__init__.py — REQUIRED
from .shipment import Shipment
from .quota import QuotaAllocation
from .planning import WeeklyHarvestPlan

__all__ = ['Shipment', 'QuotaAllocation', 'WeeklyHarvestPlan']
```
Without this, `makemigrations` silently ignores the models. No error, just missing migrations.

### 2. Use string references for cross-app ForeignKeys
Never import model classes directly for FK definitions between apps. Use Django's lazy string reference:
```python
# WRONG — hard import, breaks if core hasn't loaded yet
from apps.core.models import ExportFirm
firm = models.ForeignKey(ExportFirm, on_delete=models.PROTECT)

# RIGHT — lazy resolution, no import needed
firm = models.ForeignKey('core.ExportFirm', on_delete=models.PROTECT)
```
This applies to ALL cross-app ForeignKeys. Within the same app, direct imports are fine.

### 3. Cross-app coordination: explicit services, NOT signals
When one app's action needs to trigger another app's logic (e.g., shipment completed → update contract totals), do NOT use Django signals. They're implicit, hard to debug, and fail silently.

Instead, use explicit service calls respecting the dependency direction:
```python
# export/services.py — export CAN call contracts (allowed direction)
from apps.contracts.services import update_contract_totals

def complete_shipment(shipment, user):
    shipment.transition_to('tamamlandy', user)
    update_contract_totals(shipment.contract_id)  # explicit, debuggable
```
The calling app must be upstream of the called app in the dependency graph. If the direction is wrong (e.g., transport wanting to call finance), refactor the logic into a shared service in the nearest common upstream app.

---

# Clean Code Rules — Python/Django Backend

## Naming
- **Classes**: PascalCase, singular nouns — `Shipment`, `ExportFirm`, `ShipmentStatusLog`
- **Functions/methods**: snake_case, verb-first — `get_active_shipments()`, `calculate_quota_balance()`
- **Variables**: snake_case, descriptive — `total_weight`, `active_firms`, never `x`, `tmp`, `data`
- **Constants**: SCREAMING_SNAKE — `MAX_TRUCK_WEIGHT_KG = 18500`, `BATCH_SIZE = 500`
- **Booleans**: prefix with `is_`, `has_`, `can_` — `is_active`, `has_report`, `can_transition`
- **Private**: prefix with `_` — `_validate_transition()`, `_calculate_net_weight()`
- **QuerySet methods**: describe what they return — `get_pending_shipments()` not `filter_data()`

## Functions
- Max 20 lines per function. If longer → extract helper methods
- One responsibility per function — if you write "and" describing it, split it
- Max 3 parameters. More → use a dataclass or kwargs dict
- Always type-hint parameters and return values:
  ```python
  def calculate_quota_balance(firm: ExportFirm, period: int) -> Decimal:
  ```
- Never use mutable default arguments: `def f(items=None):` not `def f(items=[]):`
- Return early for guard clauses — avoid deep nesting:
  ```python
  # GOOD
  def get_shipment(shipment_code: str) -> Shipment:
      if not shipment_code:
          raise ValueError("Shipment code required")
      shipment = Shipment.objects.filter(shipment_code=shipment_code).first()
      if not shipment:
          raise Shipment.DoesNotExist(f"No shipment: {shipment_code}")
      return shipment
  
  # BAD — unnecessary nesting
  def get_shipment(shipment_code):
      if shipment_code:
          shipment = Shipment.objects.filter(shipment_code=shipment_code).first()
          if shipment:
              return shipment
          else:
              raise Shipment.DoesNotExist()
      else:
          raise ValueError()
  ```

## Classes
- Max 200 lines per file. If a model file exceeds this → split into `models/` package
- Django models: group fields by purpose with comments:
  ```python
  class Shipment(models.Model):
      # === Identifiers ===
      shipment_code = models.CharField(...)
      
      # === Relationships ===
      export_firm = models.ForeignKey(...)
      
      # === Weight data ===
      weight_net = models.DecimalField(...)
      
      # === Timestamps ===
      created_at = models.DateTimeField(...)
  ```
- Serializers: read-only computed fields at the top, writable fields below
- ViewSets: keep thin — delegate to model methods or `services.py`

## Imports
- Order: stdlib → Django → third-party → project apps
- Separate groups with blank lines
- Absolute imports only: `from apps.core.models import ExportFirm` not `from ..core.models import`
- Never `from module import *`
  ```python
  import logging
  from decimal import Decimal
  
  from django.db import models
  from django.utils import timezone
  from rest_framework import serializers
  
  from apps.core.models import ExportFirm, Country
  from apps.export.services import calculate_quota
  ```

## Error Handling
- Catch specific exceptions, never bare `except:`
- Business logic errors → `ValueError` or custom exception classes
- Let Django/DRF handle HTTP error responses in views
- Log unexpected errors with context:
  ```python
  logger.error("Quota calc failed for firm=%s period=%d", firm.id, period, exc_info=True)
  ```

## Comments & Docstrings
- Docstrings on every public class and function (Google style):
  ```python
  def transition_to(self, new_status_id: int, user: User, notes: str = "") -> None:
      """Execute a validated status transition.
      
      Args:
          new_status_id: Target status ID from ShipmentStatusType.
          user: User performing the transition.
          notes: Optional transition notes for audit log.
      
      Raises:
          ValueError: If transition is not allowed from current status.
      """
  ```
- No obvious comments: `# increment counter` → delete this
- Comment the WHY, not the WHAT: `# MSSQL can't DISTINCT ON, use window function` → good
- TODO format: `# TODO(jasurbek): description — ticket/date`

## DRY Principle
- If you copy-paste code → extract into a shared utility
- Shared serializer mixins for repeated field patterns
- Common queryset filters → custom Manager methods:
  ```python
  class ShipmentManager(models.Manager):
      def active(self):
          return self.exclude(status__is_terminal=True)
      
      def for_period(self, year: int, month: int):
          return self.filter(departure_date__year=year, departure_date__month=month)
  ```
- Shared permission logic → `apps/core/permissions.py`

## QuerySet Hygiene
- Always `select_related()` for ForeignKey fields accessed in serializers
- Always `prefetch_related()` for reverse FK / M2M accessed in list views
- Never query inside a loop — batch with `in` or `prefetch_related`
- Use `.only()` or `.defer()` for heavy text fields in list endpoints
- Annotate aggregations in the DB, not in Python:
  ```python
  # GOOD — DB does the work
  firms.annotate(total_weight=Sum('shipments__weight_net'))
  
  # BAD — N+1 query in Python
  for firm in firms:
      firm.total = sum(s.weight_net for s in firm.shipments.all())
  ```
