"""One-off cleanup: remove WeeklyLocalSellPlan rows left by the buggy local-sales
import that misattributed two firms.

The earlier import_local_sales mapping sent:
  - "Tel G Amangeldiyew" sales to firm #8 (Tel Guwanc A.)  — should be #19
  - "Tel GJ" sales to firm #13 (Tel Jumamyradow G)         — should be #18
import_local_sales now writes those to the correct firms (#18/#19). The stale,
import-origin rows on #8/#13 (status='approved', entered_by IS NULL) would
double-count ~172,600 kg, so they are deleted here. Human-entered draft rows
(entered_by set) are preserved.

Usage:
    python manage.py cleanup_mislabeled_local_sales            # dry-run (default)
    python manage.py cleanup_mislabeled_local_sales --commit   # delete
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import WeeklyLocalSellPlan

MISLABELED_FIRM_IDS = [8, 13]


class Command(BaseCommand):
    help = 'Delete import-origin WeeklyLocalSellPlan rows misattributed to firms 8/13'

    def add_arguments(self, parser):
        parser.add_argument('--commit', action='store_true', help='Delete (default: dry-run)')

    def handle(self, *args, **options):
        stale = WeeklyLocalSellPlan.objects.filter(
            export_firm_id__in=MISLABELED_FIRM_IDS,
            status='approved',
            entered_by__isnull=True,
        )
        self.stdout.write(f'Matched {stale.count()} stale import-origin row(s):')
        for p in stale.order_by('export_firm_id', 'year', 'week_number'):
            total = (
                p.monday_plan_kg + p.tuesday_plan_kg + p.wednesday_plan_kg
                + p.thursday_plan_kg + p.friday_plan_kg + p.saturday_plan_kg
            )
            self.stdout.write(
                f'  firm#{p.export_firm_id} W{p.week_number}/{p.year} '
                f'total={total} status={p.status}'
            )

        preserved = WeeklyLocalSellPlan.objects.filter(
            export_firm_id__in=MISLABELED_FIRM_IDS,
        ).exclude(pk__in=stale.values('pk')).count()
        self.stdout.write(f'  Preserving {preserved} other row(s) on firms 8/13 (e.g. user drafts).')

        if not options['commit']:
            self.stdout.write('\n  DRY RUN -- use --commit to delete')
            return

        with transaction.atomic():
            n, _ = stale.delete()
        self.stdout.write(self.style.SUCCESS(f'\n  Deleted {n} stale row(s).'))
