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
