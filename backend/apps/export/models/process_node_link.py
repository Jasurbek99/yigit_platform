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
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


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
    route = models.CharField(max_length=120, blank=True, default='')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('export', 'process_node_links')
        ordering = ['node_id']

    def __str__(self) -> str:
        return f'{self.node_id} -> {self.route or "(unlinked)"}'
