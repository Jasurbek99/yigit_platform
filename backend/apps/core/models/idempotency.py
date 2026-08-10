from django.db import models


class IdempotencyKey(models.Model):
    """One client-declared attempt at one write, with its recorded outcome.

    The UniqueConstraint is the mechanism, not a safety net: the decorator in
    apps/core/idempotency.py INSERTs this row BEFORE running the view, so two
    concurrent retries race on the constraint and exactly one wins. A
    check-then-create would let both through.

    status_code IS NULL means the request is still in flight, not that there
    was no response.
    """

    # === Identity of the attempt ===
    user = models.ForeignKey('core.User', on_delete=models.CASCADE)
    endpoint = models.CharField(max_length=200)
    key = models.CharField(max_length=64)

    # === Recorded outcome ===
    # response_body holds rendered JSON. Comment bodies carry Turkmen and
    # Russian text, so the column needs an explicit Cyrillic collation.
    status_code = models.PositiveSmallIntegerField(null=True)
    response_body = models.TextField(
        db_collation='Cyrillic_General_CI_AS', null=True,
    )

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'core_idempotency_keys'
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'endpoint', 'key'],
                name='uq_idempotency_user_endpoint_key',
            ),
        ]
        indexes = [models.Index(fields=['created_at'])]

    def __str__(self) -> str:
        return f'{self.user_id}:{self.endpoint}:{self.key}'
