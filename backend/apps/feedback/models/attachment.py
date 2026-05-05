from django.db import models


class FeedbackAttachment(models.Model):
    """File attachment for a feedback ticket or reply.

    Exactly one of ticket or reply must be set (enforced by CheckConstraint).
    File validation (magic bytes, size, extension) is done at the service layer
    before this model is saved.
    """

    # === Parent (exactly one must be non-null) ===
    ticket = models.ForeignKey(
        'feedback.FeedbackTicket',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attachments',
    )
    reply = models.ForeignKey(
        'feedback.FeedbackReply',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attachments',
    )

    # === File ===
    file = models.FileField(upload_to='feedback/%Y/%m/')
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=100)
    size_bytes = models.IntegerField()

    # === Audit ===
    uploaded_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(ticket__isnull=False, reply__isnull=True)
                    | models.Q(ticket__isnull=True, reply__isnull=False)
                ),
                name='attachment_has_exactly_one_parent',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.original_filename} ({self.size_bytes} bytes)'
