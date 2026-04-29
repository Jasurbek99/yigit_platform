"""Cell-level audit helpers for shipment field edits.

Location choice: placed in ``apps/export/services/sheet_audit.py`` because
``backend/apps/export/services/`` is already a package (created for
``comments.py``, ``shipment.py``, ``boss_analytics.py``). The task instructions
offered ``services_sheet_audit.py`` at the app root (Option A) as the default,
but noted "unless there's a strong reason" — the existing ``services/`` package
is that reason. Direct import path::

    from apps.export.services.sheet_audit import snapshot_fields, diff_audit_rows

This module is intentionally NOT re-exported from ``services/__init__.py``
to keep the init file focused on the shipment lifecycle symbols that callers
import via ``from apps.export.services import transition_to, ...``. Callers
that need audit helpers import this module directly.

Responsibility: compute before/after snapshots and produce unsaved ``AuditLog``
instances for ``bulk_create()``. Writing to the DB is the caller's job so that
the caller controls the transaction boundary (save + audit in one atomic block).

Known limitation: fields modified by ``save()`` side effects (computed totals,
auto status transitions triggered by signals) are NOT captured here. Those
mutations should write their own AuditLog rows from inside the service that
triggers them — already the pattern for status transitions in ``services/shipment.py``.
"""
from decimal import Decimal

from django.db import models


def render_field_value(value) -> str:
    """Render a Python value as a stable display string for audit logs.

    Used for BOTH the snapshot comparison AND the stored old/new_value, so
    diffing rendered strings avoids false-positive audit rows on FK identity
    changes — the FK object is re-fetched each request, but ``str()`` is stable.

    Handles:
    - ``None`` and empty string → ``''``
    - Django model instances → ``str(instance)`` (human-readable, not raw PK)
    - ``date`` / ``datetime`` / ``time`` objects → ISO 8601 string
    - ``Decimal`` → fixed-point notation (no scientific notation)
    - ``TextChoices`` / ``IntegerChoices`` enum members → human-readable label
    - Everything else → ``str(value)``

    Note: ``vehicle_condition`` and similar plain ``CharField(choices=...)`` fields
    store and return raw strings (e.g. ``'BREAKDOWN'``), NOT TextChoices members.
    The ``.label`` branch only fires for actual enum members (e.g.
    ``MyChoices.SOMETHING``). Raw choice strings render as themselves.

    Args:
        value: Any Python value retrieved via ``getattr(instance, field_name)``.

    Returns:
        A stable, human-readable string representation.
    """
    if value is None or value == '':
        return ''
    if isinstance(value, models.Model):
        return str(value)                    # e.g. "Begjan" not "5"
    if hasattr(value, 'isoformat'):          # date / datetime / time
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, 'f')            # no scientific notation
    if hasattr(value, 'label'):              # TextChoices / IntegerChoices member
        return value.label
    return str(value)


def snapshot_fields(instance, field_names: list[str]) -> dict[str, str]:
    """Return ``{field_name: render_field_value(getattr(instance, field_name))}``.

    Tolerant of missing attributes — returns ``''`` if ``getattr`` raises
    ``AttributeError`` (e.g. computed fields exposed only via the serializer but
    with no corresponding model attribute).

    Args:
        instance: A Django model instance (typically ``Shipment``).
        field_names: List of attribute names to snapshot. These are the
            serializer field names present in ``serializer.validated_data.keys()``,
            which for ``ShipmentPatchSerializer`` match the model attribute names
            (e.g. ``'weight_net'``, ``'country'``).

    Returns:
        Dict mapping each field name to its rendered string value.
    """
    result: dict[str, str] = {}
    for name in field_names:
        try:
            value = getattr(instance, name)
        except AttributeError:
            value = None
        result[name] = render_field_value(value)
    return result


def diff_audit_rows(instance, before: dict[str, str], after: dict[str, str], user) -> list:
    """Build (but don't save) AuditLog rows for fields whose values changed.

    Compares rendered strings from ``before`` and ``after`` snapshots. Only
    fields where the rendered value actually changed produce a row — submitting
    the same value produces zero rows.

    The ``AuditLog`` import is lazy (inside this function) to avoid circular
    imports: ``apps.export.services.*`` are imported by ``apps.export.models``
    indirectly in some test setups.

    Module name ``'Shipment'`` is hard-coded — this helper is only ever called
    for shipments. Generalise when another model needs cell-level auditing.

    Args:
        instance: The Shipment instance after ``save()`` and ``refresh_from_db()``.
        before: ``{field_name: rendered_value}`` captured before ``serializer.save()``.
        after: ``{field_name: rendered_value}`` captured after ``refresh_from_db()``.
        user: The authenticated User performing the edit.

    Returns:
        List of unsaved ``AuditLog`` instances ready for ``bulk_create(batch_size=500)``.
        Returns an empty list if no fields changed.
    """
    # Lazy import avoids circular dependency: apps.export.models → services → models
    from apps.export.models.audit import AuditLog  # noqa: PLC0415

    rows = []
    for field_name, old_val in before.items():
        new_val = after.get(field_name, '')
        if old_val == new_val:
            continue
        rows.append(
            AuditLog(
                action='update',
                model_name='Shipment',
                object_id=instance.id,
                object_repr=str(instance.cargo_code or instance.pk),
                field_name=field_name,
                old_value=old_val,
                new_value=new_val,
                detail=f'{field_name}: {old_val} → {new_val}',
                user=user,
            )
        )
    return rows
