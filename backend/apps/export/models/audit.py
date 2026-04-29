from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class AuditLog(models.Model):
    """Immutable audit trail for create/update/transition events.

    Written by services.py on every successful status transition and by
    serializer save hooks for create/update operations. Never mutated after
    creation — read-only through the API.

    DDL: export_audit_log
    """

    ACTION_CHOICES = [
        ('transition', 'Status transition'),
        ('create', 'Created'),
        ('update', 'Updated'),
    ]

    # === Who ===
    user = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='user_id',
        related_name='audit_logs',
    )

    # === What ===
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    model_name = models.CharField(max_length=50)
    object_id = models.IntegerField()
    object_repr = models.CharField(max_length=200, **cyrillic_collation())

    # === Detail ===
    # Free-form description: e.g. 'yuklenme → gumruk_girish' or 'weight_net changed 18400→18500'
    # CharField not TextField — MSSQL compatible, 1000 chars sufficient for audit lines.
    detail = models.CharField(max_length=1000, blank=True, **cyrillic_collation())

    # === Structured field-level audit (D8) ===
    # Set on 'update' actions caused by a PATCH to a specific model field.
    # blank=True / default='' means existing transition/create rows work unchanged.
    field_name = models.CharField(
        max_length=60,
        blank=True,
        default='',
        db_index=True,
        help_text='Serializer field name for cell-level edit audit. Empty for transition/create rows.',
    )
    old_value = models.TextField(
        blank=True,
        default='',
        **cyrillic_collation(),
        help_text='Rendered string of the value before the edit (via _render()). May be Cyrillic.',
    )
    new_value = models.TextField(
        blank=True,
        default='',
        **cyrillic_collation(),
        help_text='Rendered string of the value after the edit (via _render()). May be Cyrillic.',
    )

    # === Audit ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'audit_log')
        ordering = ['-created_at']
        indexes = [
            models.Index(
                fields=['model_name', 'object_id', 'field_name', '-created_at'],
                name='audit_field_history_idx',
            ),
        ]

    def __str__(self) -> str:
        return f'[{self.action}] {self.model_name}#{self.object_id} by user={self.user_id}'
