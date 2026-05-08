"""Daily rollup of HarvestDayEntry.actual_value from shipment loading data.

For a given local date D (Asia/Ashgabat by default), sum
ShipmentBlockSource.weight_kg per block where the parent Shipment's
loading_started_at falls inside D's local-day UTC range, then write the sum
to the matching HarvestDayEntry row. The rollup job is intended to run once
per day for D = yesterday (after midnight local), but the function also
supports re-runs for any historical date.

Idempotency:
  Re-running for the same date overwrites the previous shipment_rollup
  result (SUM is deterministic). Rows whose actual_source is
  'admin_override' are skipped unless force=True — admin manual edits win.

Timezone correctness:
  Shipment.loading_started_at is DateTimeField (DATETIMEOFFSET in MSSQL),
  stored in UTC. The harvest "day" is local. We filter on a
  timezone-aware UTC range derived from the local date, NOT on
  loading_started_at__date — Django pushes __date to the DB and MSSQL
  evaluates it in the connection's timezone (UTC by default), shifting
  the answer for shipments loaded near midnight.
"""
import logging
from dataclasses import dataclass, field
from datetime import date as date_type, datetime, time as dtime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

logger = logging.getLogger(__name__)


@dataclass
class RollupResult:
    """Outcome of one rollup run, suitable for logs and command output."""

    target_date: date_type
    blocks_with_shipments: int = 0          # how many distinct blocks had shipments
    entries_updated: int = 0                # HarvestDayEntry rows actually written
    entries_skipped_override: int = 0       # rows skipped because actual_source='admin_override'
    entries_missing: int = 0                # blocks with shipments but no HarvestDayEntry row
    shipments_without_blocks: list = field(default_factory=list)  # (id, cargo_code)
    total_kg: Decimal = Decimal('0')
    dry_run: bool = False


def rollup_actuals_for_date(
    target_date: date_type,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> RollupResult:
    """Compute and write actual_value for HarvestDayEntry rows on target_date.

    Args:
        target_date: The local date to roll up (Asia/Ashgabat from GreenhouseConfig).
        force: If True, overwrite even rows whose actual_source='admin_override'.
        dry_run: If True, compute and log but do not write.

    Returns:
        RollupResult with counters for entries updated / skipped / missing,
        plus a list of shipments that had loading_started_at on target_date
        but no ShipmentBlockSource rows (silent under-reporting).
    """
    # Lazy imports to avoid loading these models at app-startup.
    from apps.core.models import GreenhouseConfig
    from apps.export.models.shipment import Shipment, ShipmentBlockSource
    from apps.greenhouse.models import HarvestDayEntry

    config = GreenhouseConfig.get_solo()
    tz = ZoneInfo(config.timezone_name)

    # Build the timezone-aware UTC range that corresponds to target_date in local.
    start_aware = datetime.combine(target_date, dtime(0, 0)).replace(tzinfo=tz)
    end_aware = start_aware + timedelta(days=1)

    # ── 1) Aggregate weight per block from ShipmentBlockSource ──────────
    block_sums = (
        ShipmentBlockSource.objects.filter(
            shipment__loading_started_at__gte=start_aware,
            shipment__loading_started_at__lt=end_aware,
        )
        .values('block_id')
        .annotate(total_kg=Sum('weight_kg'))
    )
    block_totals = {row['block_id']: row['total_kg'] or Decimal('0') for row in block_sums}

    # ── 2) Detect shipments loaded that day with no block_sources rows ──
    shipments_no_blocks = list(
        Shipment.objects
        .filter(loading_started_at__gte=start_aware, loading_started_at__lt=end_aware)
        .filter(block_sources__isnull=True)
        .values_list('id', 'cargo_code')
    )

    result = RollupResult(
        target_date=target_date,
        blocks_with_shipments=len(block_totals),
        shipments_without_blocks=shipments_no_blocks,
        total_kg=sum(block_totals.values(), Decimal('0')),
        dry_run=dry_run,
    )

    if not block_totals:
        logger.info('rollup_actuals %s: no shipments with block sources', target_date)
        return result

    # ── 3) Find or fail to find HarvestDayEntry rows ────────────────────
    entries = {
        e.block_id: e
        for e in HarvestDayEntry.objects.filter(
            entry_date=target_date,
            block_id__in=block_totals.keys(),
        ).select_related('block')
    }

    missing_block_ids = set(block_totals.keys()) - set(entries.keys())
    result.entries_missing = len(missing_block_ids)
    if missing_block_ids:
        logger.warning(
            'rollup_actuals %s: %d block(s) had shipments but no HarvestDayEntry '
            '(weekly plan not initialized): block_ids=%s',
            target_date, len(missing_block_ids), sorted(missing_block_ids),
        )

    # ── 4) Write or skip per row ────────────────────────────────────────
    now_utc = timezone.now()
    to_update = []
    for block_id, entry in entries.items():
        if entry.actual_source == 'admin_override' and not force:
            result.entries_skipped_override += 1
            logger.info(
                'rollup_actuals %s block=%s skipped (admin_override)',
                target_date, getattr(entry.block, 'code', block_id),
            )
            continue

        new_value = block_totals[block_id]
        entry.actual_value = new_value
        entry.actual_finalized_at = now_utc
        entry.actual_source = 'shipment_rollup'
        entry.updated_at = now_utc  # auto_now does not fire on bulk_update
        to_update.append(entry)

    if not dry_run and to_update:
        with transaction.atomic():
            HarvestDayEntry.objects.bulk_update(
                to_update,
                fields=['actual_value', 'actual_finalized_at', 'actual_source', 'updated_at'],
                batch_size=500,
            )

    result.entries_updated = len(to_update)
    logger.info(
        'rollup_actuals %s: updated=%d skipped_override=%d missing=%d '
        'no_blocks=%d total_kg=%s%s',
        target_date, result.entries_updated, result.entries_skipped_override,
        result.entries_missing, len(shipments_no_blocks), result.total_kg,
        ' (dry-run)' if dry_run else '',
    )
    return result


def yesterday_local() -> date_type:
    """Return yesterday's date in the configured greenhouse timezone."""
    from apps.core.models import GreenhouseConfig

    config = GreenhouseConfig.get_solo()
    tz = ZoneInfo(config.timezone_name)
    today_local = timezone.now().astimezone(tz).date()
    return today_local - timedelta(days=1)
