"""A document generated (downloaded) for a shipment — closes the matching print
task, even one that spawns later (spec 2026-09-30-prep-docs-tasks-design §3)."""
from django.db import models


class ShipmentDocumentDownload(models.Model):
    shipment = models.ForeignKey(
        'export.Shipment', on_delete=models.CASCADE, related_name='document_downloads',
    )
    doc_key = models.CharField(max_length=24)          # cmr | tir | ct1 | phyto | customs_request
    downloaded_by = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    downloaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'export_shipment_document_download'
        indexes = [models.Index(fields=['shipment', 'doc_key'], name='export_sdd_ship_doc_idx')]

    def __str__(self) -> str:
        return f'{self.doc_key} for shipment {self.shipment_id}'
