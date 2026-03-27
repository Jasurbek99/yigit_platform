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
  def get_shipment(cargo_code: str) -> Shipment:
      if not cargo_code:
          raise ValueError("Cargo code required")
      shipment = Shipment.objects.filter(cargo_code=cargo_code).first()
      if not shipment:
          raise Shipment.DoesNotExist(f"No shipment: {cargo_code}")
      return shipment
  
  # BAD — unnecessary nesting
  def get_shipment(cargo_code):
      if cargo_code:
          shipment = Shipment.objects.filter(cargo_code=cargo_code).first()
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
      cargo_code = models.CharField(...)
      
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
