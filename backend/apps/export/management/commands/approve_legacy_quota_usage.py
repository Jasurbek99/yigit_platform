"""Convert the leftover draft QuotaUsageRecord rows to approved.

One-shot cleanup for the 2026-08-10 removal of the quota-usage approval step.
Every row created from that day on is born `status='approved'`, so a `draft` row
can only be pre-cutover data — and a draft counts in no ledger, meaning those kg
are silently missing from FIFO, the firm balances and the dashboard for as long
as they sit there. Nothing will ever approve them: the `/approve/` endpoint is
gone.

`approved_by` / `approved_at` are deliberately left NULL. Nobody reviewed these
rows, and stamping a user would put a false signature in the audit trail. After
the cutover `status='approved'` means "counted", not "signed" — see
`QuotaUsageViewSet`'s docstring.

This CHANGES PUBLISHED NUMBERS: quota consumption goes up by whatever these rows
carry. Run `--dry-run` first and read the total.

    python manage.py approve_legacy_quota_usage --dry-run
    python manage.py approve_legacy_quota_usage
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, Sum

from apps.export.models import QuotaUsageRecord
from apps.export.services.quota_sync import invalidate_quota_caches


class Command(BaseCommand):
    help = 'Convert leftover draft quota-usage rows to approved (pre-2026-08-10 data).'

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would change without writing.',
        )

    def handle(self, *args, **options) -> None:
        drafts = QuotaUsageRecord.objects.filter(status='draft')
        total = drafts.count()

        if total == 0:
            self.stdout.write(self.style.SUCCESS('No draft rows left — nothing to do.'))
            return

        total_kg = drafts.aggregate(kg=Sum('kg_used'))['kg'] or Decimal('0')
        linked = drafts.filter(shipment__isnull=False).count()

        self.stdout.write(f'Draft rows:        {total}')
        self.stdout.write(f'  linked to a shipment: {linked}')
        self.stdout.write(f'  manual / imported:    {total - linked}')
        self.stdout.write(f'Quota this releases into the ledger: {total_kg} kg')

        by_firm = (
            drafts.values('export_firm__code')
            .annotate(n=Count('id'), kg=Sum('kg_used'))
            .order_by('-kg')
        )
        for row in by_firm[:10]:
            self.stdout.write(
                f"  {row['export_firm__code'] or '?':<10} {row['n']:>4} rows  {row['kg']} kg"
            )

        if options['dry_run']:
            self.stdout.write(self.style.WARNING('\n--dry-run: nothing written.'))
            return

        with transaction.atomic():
            updated = drafts.update(status='approved')
            transaction.on_commit(invalidate_quota_caches)

        self.stdout.write(self.style.SUCCESS(f'\nApproved {updated} rows ({total_kg} kg).'))
