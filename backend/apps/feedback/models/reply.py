from django.db import models


class FeedbackReply(models.Model):
    """Admin reply to a feedback ticket.

    Supports three modes:
    - standard: visible to both the author and admin (default response)
    - internal: admin-only note, hidden from the ticket author
    - public: promoted to the Public Feed along with the parent ticket

    is_internal and is_public are denormalised booleans synced from mode on save().
    This ensures the DB cannot enter an inconsistent state.
    """

    MODE_CHOICES = [
        ('standard', 'Standard'),
        ('internal', 'Internal'),
        ('public', 'Public'),
    ]

    # === Relationships ===
    ticket = models.ForeignKey(
        'feedback.FeedbackTicket',
        on_delete=models.CASCADE,
        related_name='replies',
    )
    author = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
    )

    # === Content — Cyrillic collation for user-entered text ===
    content = models.CharField(max_length=4000, db_collation='Cyrillic_General_CI_AS')

    # === Mode + denormalised flags ===
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='standard')
    is_internal = models.BooleanField(default=False)  # denormalised from mode
    is_public = models.BooleanField(default=False)    # denormalised from mode

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs) -> None:
        """Sync denormalised flags from mode before persisting.

        Mutual exclusion is enforced here — the DB cannot be in an invalid
        state where both is_internal=True and is_public=True simultaneously.
        """
        self.is_internal = (self.mode == 'internal')
        self.is_public = (self.mode == 'public')
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'Reply by {self.author_id} on ticket {self.ticket_id} [{self.mode}]'
