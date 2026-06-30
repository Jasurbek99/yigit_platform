"""System checks for the Task Engine.

Guards against the failure mode that stranded the "fill loading data" task in
2026-06. A Shipment field was renamed (``cargo_code`` -> ``shipment_code``) and
the data migration (0042) swept the rename through the Sheet / Comment /
Notification tables but missed ``TaskRule.target_fields``. The stale rule then
referenced a field that no longer existed on the model, so the resolver read it
as "never filled", ``ALL_FIELDS_FILLED`` could never be satisfied, and the task
hung forever — with no error anywhere.

This check turns that silent failure into a loud deploy-time one: it fails
``manage.py migrate`` / ``manage.py check --database default`` whenever an active
``TaskRule`` names a ``target_fields`` (or ``condition_field``) entry that does
not resolve to an attribute on the ``Shipment`` model.

It mirrors the resolver's own access pattern (``hasattr(Shipment, name)`` —
see ``services/task_rules._resolve_value``) so what the check validates is
exactly what the engine will try to read at runtime. Dotted paths
(e.g. ``quality.azyk_maglumatnama``) are validated at their relation root only;
the resolver tolerates missing leaves, and validating deeper would risk false
positives across related models.
"""
from django.core.checks import Error, Tags, register


@register(Tags.database)
def check_task_rule_fields(app_configs, **kwargs):
    """Fail if any active TaskRule points at a Shipment field that doesn't exist."""
    from django.db.utils import OperationalError, ProgrammingError

    try:
        from apps.export.models import Shipment, TaskRule

        rules = list(
            TaskRule.objects.filter(is_active=True)
            .values('id', 'step', 'title_key', 'target_fields', 'condition_field')
        )
    except (OperationalError, ProgrammingError):
        # Tables not migrated yet (e.g. the initial `migrate` on a fresh DB runs
        # checks before the TaskRule table exists). Nothing to validate — skip.
        return []

    def resolves(name: str) -> bool:
        # Validate the relation root for dotted paths (quality.* etc.); the
        # resolver walks deeper and tolerates a missing leaf.
        return hasattr(Shipment, name.split('.', 1)[0])

    errors = []
    for rule in rules:
        bad = [
            name.strip()
            for name in (rule['target_fields'] or '').split(',')
            if name.strip() and not resolves(name.strip())
        ]
        cond = (rule['condition_field'] or '').strip()
        if cond and not resolves(cond):
            bad.append(cond)

        if bad:
            errors.append(
                Error(
                    f"TaskRule #{rule['id']} ({rule['step']}/{rule['title_key']}) "
                    f"references Shipment field(s) that do not exist: "
                    f"{', '.join(bad)}.",
                    hint=(
                        "A Shipment field was likely renamed without updating the "
                        "Task Engine. Fix the seed in "
                        "apps/export/management/commands/seed_task_rules.py, then run "
                        "`python manage.py seed_task_rules` to re-seed the rules and "
                        "reconcile open tasks."
                    ),
                    id='export.E001',
                )
            )
    return errors
