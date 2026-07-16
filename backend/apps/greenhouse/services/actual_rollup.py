"""Daily rollup of HarvestDayEntry.actual_value from shipment loading data.

For a given date D, sum ShipmentBlockSource.weight_kg per block for every
shipment whose loading day equals D, then write the sum to the matching
HarvestDayEntry row. The rollup job is intended to run once per day for
D = yesterday, but the function also supports re-runs for any historical date.

Loading day = the day encoded in the numeric shipment_code (`DDMMNNN/YY`),
NOT loading_started_at. loading_started_at is null on many shipments post-AD-1
and can drift a calendar day from the real load; the code always exists and
its DDMM matches shipment.date 100% of the time in production data. Sub-blocks
(F1/F2) are summed into their parent (F) because HarvestDayEntry is keyed on
top-level blocks.

Known limitation: legacy shipments imported under the old letter-month code
convention (`DDCC###/YY`, e.g. "10AP116/25") do not match the numeric DDMM
prefix and are excluded — harmless for the daily rollup (current codes are
numeric-only, enforced by validate_shipment_code) but relevant if the rollup is
ever re-run over historical dates.

Idempotency:
  Re-running for the same date overwrites the previous shipment_rollup
  result (SUM is deterministic). Rows whose actual_source is
  'admin_override' are skipped unless force=True — admin manual edits win.
"""
import logging
import re
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

# Numeric shipment code: DD MM NNN / YY  (e.g. "1004116/26" → 2026-04-10).
_CODE_DATE_RE = re.compile(r'^(\d{2})(\d{2})\d+/(\d{2})$')


def parse_shipment_code_date(code: str | None) -> date_type | None:
    """Parse the loading date from the numeric shipment code (`DDMMNNN/YY`).

    Returns None for a blank or malformed code, or an impossible date.
    """
    if not code:
        return None
    match = _CODE_DATE_RE.match(code)
    if not match:
        return None
    try:
        return date_type(2000 + int(match.group(3)), int(match.group(2)), int(match.group(1)))
    except ValueError:
        return None


@dataclass
class RollupResult:
    """Outcome of one rollup run, suitable for logs and command output."""

    target_date: date_type
    blocks_with_shipments: int = 0          # how many distinct blocks had shipments
    entries_updated: int = 0                # HarvestDayEntry rows actually written
    entries_skipped_override: int = 0       # rows skipped because actual_source='admin_override'
    entries_missing: int = 0                # blocks with shipments but no HarvestDayEntry row
    shipments_without_blocks: list = field(default_factory=list)  # (id, shipment_code)
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
        plus a list of shipments whose code-date is target_date but which have
        no ShipmentBlockSource rows (silent under-reporting).
    """
    # Lazy imports to avoid loading these models at app-startup.
    from apps.core.models import GreenhouseBlock
    from apps.export.models.shipment import Shipment, ShipmentBlockSource
    from apps.greenhouse.models import HarvestDayEntry

    # ── 0) Shipments whose code encodes target_date ─────────────────────
    # Prefilter by the DDMM prefix in the DB, then confirm the full date
    # (including year) in Python via the code parser.
    dd_mm = f'{target_date.day:02d}{target_date.month:02d}'
    matching_ids = []
    malformed_codes = []
    for sid, code in (
        Shipment.objects.filter(shipment_code__startswith=dd_mm)
        .values_list('id', 'shipment_code')
    ):
        parsed = parse_shipment_code_date(code)
        if parsed == target_date:
            matching_ids.append(sid)
        elif parsed is None:
            malformed_codes.append(code)
    if malformed_codes:
        # No silent drops: a code that matched the DDMM prefix but didn't parse
        # (e.g. missing /YY) is excluded — surface it for debugging.
        logger.warning(
            'rollup_actuals %s: %d shipment code(s) matched prefix %s but did not '
            'parse and were excluded: %s',
            target_date, len(malformed_codes), dd_mm, malformed_codes,
        )

    # Parent-block map so sub-block sources (F1/F2) fold into their parent (F),
    # which is how HarvestDayEntry is keyed. Tree is one level deep.
    parent_of = {
        b['id']: (b['parent_id'] or b['id'])
        for b in GreenhouseBlock.objects.values('id', 'parent_id')
    }

    # ── 1) Aggregate weight per (parent) block from ShipmentBlockSource ─
    block_sums = (
        ShipmentBlockSource.objects.filter(shipment_id__in=matching_ids)
        .values('block_id')
        .annotate(total_kg=Sum('weight_kg'))
    )
    block_totals: dict[int, Decimal] = {}
    for row in block_sums:
        top_id = parent_of.get(row['block_id'], row['block_id'])
        block_totals[top_id] = block_totals.get(top_id, Decimal('0')) + (row['total_kg'] or Decimal('0'))

    # ── 2) Detect shipments loaded that day with no block_sources rows ──
    shipments_no_blocks = list(
        Shipment.objects
        .filter(id__in=matching_ids, block_sources__isnull=True)
        .values_list('id', 'shipment_code')
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
