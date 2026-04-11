from django.db import models
from apps.core.db_utils import schema_table


class BlockManagerAssignment(models.Model):
    """Maps a greenhouse_manager user to one or more greenhouse blocks.

    Used by WeeklyHarvestPlanViewSet to enforce per-block write authorization:
    a greenhouse_manager may only create/update harvest plans for blocks they
    are assigned to.

    DDL: export.block_manager_assignments
    UNIQUE (user_id, block_id)
    """

    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='block_assignments',
    )
    block = models.ForeignKey(
        'core.GreenhouseBlock',
        on_delete=models.CASCADE,
        db_column='block_id',
        related_name='manager_assignments',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'block_manager_assignments')
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'block'],
                name='uq_block_manager_assignment',
            ),
        ]
        ordering = ['user', 'block__code']

    def __str__(self) -> str:
        return f'{self.user.username} → {self.block.code}'
