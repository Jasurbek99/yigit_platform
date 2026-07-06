"""ContractAttachment — a PDF document attached to a contract for download/preview."""
from django.db import models

from apps.core.db_utils import schema_table


class ContractAttachment(models.Model):
    """A PDF document attached to a contract (signed contract scan, annex, etc.).

    File validation (size, extension, magic bytes) is done at the service layer
    (``contracts.services.files.validate_contract_document``) before this model
    is saved. Files are served only through the authenticated download action on
    ContractViewSet — never via a direct /media/ URL — because contract documents
    are legal/financial records.
    """

    # === Parent ===
    contract = models.ForeignKey(
        'contracts.Contract',
        on_delete=models.CASCADE,
        related_name='attachments',
    )

    # === File ===
    file = models.FileField(upload_to='contracts/%Y/%m/')
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100)
    size_bytes = models.IntegerField()

    # === Audit ===
    uploaded_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='uploaded_contract_attachments',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('contracts', 'contract_attachment')
        ordering = ['-uploaded_at']

    def __str__(self) -> str:
        return f'{self.original_filename} ({self.size_bytes} bytes)'
