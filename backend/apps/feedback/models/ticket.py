from django.db import models


class FeedbackTicket(models.Model):
    """A user-submitted feedback ticket (bug / suggestion / question).

    Status lifecycle: new → in_review → resolved | rejected.
    Tickets can be reopened by the author from resolved or rejected.
    The is_public flag is set server-side only — when admin posts a reply
    with mode='public', the ticket becomes visible on the Public Feed.
    """

    CATEGORY_CHOICES = [
        ('bug', 'Bug'),
        ('suggestion', 'Suggestion'),
        ('question', 'Question'),
    ]
    STATUS_CHOICES = [
        ('new', 'New'),
        ('in_review', 'In Review'),
        ('resolved', 'Resolved'),
        ('rejected', 'Rejected'),
    ]

    # === Relationships ===
    author = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='feedback_tickets',
    )

    # === Categorisation ===
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)

    # === Content — Cyrillic collation for user-entered text ===
    description = models.CharField(max_length=4000, db_collation='Cyrillic_General_CI_AS')

    # === Status ===
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='new',
        db_index=True,
    )

    # === Visibility ===
    is_public = models.BooleanField(default=False, db_index=True)

    # === Submission context ===
    submitted_from_path = models.CharField(max_length=255, blank=True, default='')
    submitted_from_label = models.CharField(max_length=120, blank=True, default='')
    user_agent = models.CharField(max_length=500, blank=True, default='')

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    last_activity_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-last_activity_at']
        indexes = [
            models.Index(fields=['author', '-created_at']),
            models.Index(fields=['status', '-created_at']),
        ]

    def __str__(self) -> str:
        return f'[{self.category}] {self.description[:60]} ({self.status})'
