"""Hourly cron: post per-shipment SLA-escalation notifications to management.

Phase 4b of the Sheet Control v2 master plan (ADR-0005). Pulls from the same
"stuck" filter as the dashboard but at three coarser thresholds:

  - 8 days  → kind='stuck_8d'   (entered the orange tier)
  - 15 days → kind='stuck_15d'  (entered the red tier)
  - 30 days → kind='stuck_30d'  (extended critical)

For each (shipment × threshold × recipient) tuple that has crossed but does
not yet have a Notification row, the command creates one. Re-runs are no-ops
because the (user, kind, link) tuple is the dedupe key — `link` includes the
shipment id, so the same shipment at the same threshold for the same user
never produces two notifications. Crossing the NEXT threshold creates a new
notification under the new kind.

Recipients: active users with role in ('admin', 'director', 'boss'). Mirrors
ShipmentViewSet._STUCK_VIEW_ROLES.

Usage:
    python manage.py notify_stuck_shipments
    python manage.py notify_stuck_shipments --dry-run

Cron entry — hourly so threshold crossings are picked up within ~1h:

    Linux:    0 * * * * cd /opt/ygt-platform/backend && python manage.py notify_stuck_shipments
    Windows:  Trigger every hour, action python.exe manage.py notify_stuck_shipments
              start in D:\\ygt-platform\\backend
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.core.models import User
from apps.export.models import Notification, Shipment


# Threshold tiers — (days_stuck, notification kind). Sorted ascending by days.
NOTIFY_THRESHOLDS: list[tuple[int, str]] = [
    (8, 'stuck_8d'),
    (15, 'stuck_15d'),
    (30, 'stuck_30d'),
]

RECIPIENT_ROLES = ('admin', 'director', 'boss')


class Command(BaseCommand):
    help = 'Notify management about stuck shipments crossing 8/15/30-day thresholds.'

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would be created without writing anything.',
        )

    def handle(self, *args, dry_run: bool, **opts) -> None:
        now = timezone.now()
        # Lowest threshold drives the candidate query.
        min_threshold_days = NOTIFY_THRESHOLDS[0][0]
        cutoff = now - timedelta(days=min_threshold_days)

        stuck = list(
            Shipment.objects.filter(
                is_archived=False,
                updated_at__lte=cutoff,
            )
            .exclude(status__phase='COMPLETE')
            .select_related('status')
            .only('id', 'cargo_code', 'updated_at', 'status_id', 'status__name_en', 'status__name_tk')
        )
        if not stuck:
            self.stdout.write(self.style.SUCCESS(
                f'No stuck shipments past {min_threshold_days}-day threshold.'
            ))
            return

        recipients = list(
            User.objects.filter(
                is_active=True,
                role__in=RECIPIENT_ROLES,
            ).only('id', 'role')
        )
        if not recipients:
            self.stdout.write(self.style.WARNING(
                f'No active users with role in {RECIPIENT_ROLES}; nothing to notify.'
            ))
            return

        # One query for ALL existing stuck-* notifications targeting these
        # shipments — gives us the dedupe set without N+1.
        shipment_links = [f'/shipments/{s.id}' for s in stuck]
        existing = set(
            Notification.objects.filter(
                kind__in=[k for _, k in NOTIFY_THRESHOLDS],
                link__in=shipment_links,
            ).values_list('user_id', 'kind', 'link')
        )

        # Build the queue. For each shipment, walk thresholds ascending and
        # only emit kinds the shipment has actually crossed.
        to_create: list[Notification] = []
        for shipment in stuck:
            days = (now - shipment.updated_at).days
            link = f'/shipments/{shipment.id}'
            status_name = (
                getattr(shipment.status, 'name_en', None)
                or getattr(shipment.status, 'name_tk', None)
                or '?'
            )
            for threshold_days, kind in NOTIFY_THRESHOLDS:
                if days < threshold_days:
                    continue
                for recipient in recipients:
                    if (recipient.id, kind, link) in existing:
                        continue
                    to_create.append(Notification(
                        user_id=recipient.id,
                        kind=kind,
                        message=(
                            f'Shipment {shipment.cargo_code} stuck for {days} days '
                            f'at status "{status_name}".'
                        ),
                        link=link,
                    ))

        if not to_create:
            self.stdout.write(self.style.SUCCESS(
                f'No new notifications needed ({len(stuck)} stuck shipments, '
                f'{len(recipients)} recipients — all already notified at current thresholds).'
            ))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'[DRY RUN] Would create {len(to_create)} notifications:'
            ))
            for n in to_create[:20]:
                self.stdout.write(f'  - user={n.user_id} kind={n.kind} link={n.link}')
            if len(to_create) > 20:
                self.stdout.write(f'  ... and {len(to_create) - 20} more')
            return

        Notification.objects.bulk_create(to_create, batch_size=500)
        self.stdout.write(self.style.SUCCESS(
            f'Created {len(to_create)} stuck-shipment notifications '
            f'({len(stuck)} stuck shipments, {len(recipients)} recipients).'
        ))
