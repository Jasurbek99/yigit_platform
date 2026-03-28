# TODO: move to apps.finance once P5 finance app is created — these models
# belong in the finance domain but P5 doesn't exist yet. Keeping in export/
# temporarily to avoid creating an empty app. See SPRINT_PLAN.md Sprint 4+.
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class FinansistAdvance(models.Model):
    """A batch advance issued by the finansist (Babageldi) to cover customs costs.

    One advance may cover multiple shipments. Reconciliation marks the advance
    as settled once all covered shipments are accounted for in the final sales report.
    """

    # === Identifiers ===
    batch_code = models.CharField(max_length=50, blank=True, null=True)
    advance_date = models.DateField()

    # === Financial ===
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default='USD')

    # === Metadata ===
    purpose = models.CharField(
        max_length=200, blank=True, null=True, **cyrillic_collation()
    )
    issued_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='advances_issued',
    )
    notes = models.CharField(
        max_length=500, blank=True, null=True, **cyrillic_collation()
    )

    # === Reconciliation ===
    reconciled = models.BooleanField(default=False)
    reconciled_at = models.DateTimeField(null=True, blank=True)

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'finansist_advances')
        ordering = ['-advance_date', '-id']

    def __str__(self) -> str:
        code = self.batch_code or f'ADV-{self.id}'
        return f'{code} ({self.advance_date}) {self.total_amount} {self.currency}'


class FinansistAdvanceShipment(models.Model):
    """Junction table: which shipments a batch advance covers.

    allocated_amount is the portion of the advance earmarked for this specific
    shipment. It may be NULL when the advance covers multiple shipments and the
    per-shipment split hasn't been determined yet.
    """

    advance = models.ForeignKey(
        FinansistAdvance,
        on_delete=models.CASCADE,
        related_name='shipment_links',
    )
    shipment = models.ForeignKey(
        'export.Shipment',
        on_delete=models.CASCADE,
        related_name='advance_links',
    )
    allocated_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )

    class Meta:
        db_table = schema_table('export', 'finansist_advance_shipments')
        unique_together = [('advance', 'shipment')]

    def __str__(self) -> str:
        return f'Advance {self.advance_id} → Shipment {self.shipment_id}'
