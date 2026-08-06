"""ProcessNodeLink — configurable BPMN node -> application screen mapping.

Backs the boss's process diagram (docs/how_works/shipment-bpmn.html): each
node in the diagram's JS data array carries an `id` that must match
`node_id` here. Clicking a diagram block resolves `route` and opens it in a
new tab. Editable via the admin CRUD endpoint so a route change never
requires touching the diagram HTML.

Deliberately minimal — no version field, no soft-delete, no permission
triggers. `node_id` is the join key and is read-only via the API (see
ProcessNodeLinkSerializer in apps.export.views_admin).
"""
from django.core.validators import RegexValidator
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table

# `route` is written into a diagram <a href> that the boss clicks
# (docs/how_works/shipment-bpmn.html) — see the module-level security note
# below `route`. Must be blank, exactly "/", or "/segment(/segment)*" with an
# optional trailing slash, where each segment is [A-Za-z0-9_-]+. This rejects
# by construction: any scheme (`javascript:`, `data:`, `vbscript:` — no `/`
# prefix, and `:` isn't in the whitelist), protocol-relative URLs (`//evil...`
# — the char after the leading `/` must belong to a segment, never another
# `/`), and any control or whitespace character (not in the whitelist).
# DRF's ModelSerializer copies model-field validators onto the generated
# serializer field (rest_framework.utils.field_mapping.get_field_kwargs), so
# this single validator is enforced on every PATCH through
# ProcessNodeLinkSerializer without a separate serializer-level check —
# see tests_process_node_links.py::ProcessNodeLinkRouteValidationTests.
ROUTE_VALIDATOR = RegexValidator(
    regex=r'^/([A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/?)?$',
    message='route must be blank or an in-app absolute path (e.g. "/export/plan").',
)


class ProcessNodeLink(models.Model):
    """One BPMN diagram node's mapping to a frontend route.

    DDL: export_process_node_links
    """

    # === Identity (immutable — the join key to the diagram) ===
    node_id = models.CharField(max_length=40, unique=True)

    # === Display / target ===
    # label holds the Turkmen text transcribed from the diagram, so the admin
    # table is readable without opening the HTML. Turkmen text follows the
    # project convention (CLAUDE.md) of using Cyrillic_General_CI_AS collation
    # regardless of script — matches SheetRowSetting.label_tk and
    # ExpenseCategory.name_tk elsewhere in this app.
    label = models.CharField(max_length=120, **cyrillic_collation())
    # Frontend path, e.g. '/export/plan'. Blank = "not linked" (no click-through).
    # SECURITY: this value is written into a diagram <a href> via
    # `setAttribute('href', route)` and the boss clicks it (stored-XSS if
    # unconstrained — a `javascript:` value would execute in the boss's
    # session). ROUTE_VALIDATOR is the server-side boundary; the diagram HTML
    # also guards defensively before using the value. Do not relax this
    # without re-reading that guard.
    route = models.CharField(max_length=120, blank=True, default='', validators=[ROUTE_VALIDATOR])
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('export', 'process_node_links')
        ordering = ['node_id']

    def __str__(self) -> str:
        return f'{self.node_id} -> {self.route or "(unlinked)"}'
