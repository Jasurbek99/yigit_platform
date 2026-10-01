"""Plan vs fact for one day — the truck allocation against that day's shipments.

Three readers share it: the daily task resolver (daily_plan_tasks.py), the
`progress` field on /me/tasks/, and GET /truck-allocations/daily-progress/.

- Export part: a live shipment dated the day with a country AND a customer.
- Packing: a live shipment dated the day with ≥1 block_sources, free or
  joined. One row = one truck.
- Plan rows: the day's TruckDestinationSplit (truck_count > 0), grouped by
  country. Destinations with no country (Gapy Satys) form one 'gapy' row,
  matched by Shipment.is_gapy_satys instead of a country.

Spec: docs/superpowers/specs/2026-10-01-daily-plan-progress-tasks-design.md.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, Q

from apps.export.models import Shipment, TruckDestinationSplit

PLAN_DAYS = 6  # Mon–Sat
GAPY_KEY = 'gapy'
GAPY_LABEL = 'Gapy Satys'


@dataclass(frozen=True)
class ProgressRow:
    key: str
    label: str
    country_id: int | None
    is_gapy: bool
    plan: int
    fact: int


@dataclass(frozen=True)
class DayProgress:
    date: date
    rows: list[ProgressRow]
    plan_total: int
    export_parts: int
    export_parts_packed: int
    packed: int
    loading_target: int


@dataclass
class _Bucket:
    label: str
    country_id: int | None
    is_gapy: bool
    count: int = 0
    packed: int = 0


def day_progress(day: date, season) -> DayProgress:
    """Plan vs fact for one day inside `season` (None → an empty day)."""
    return _progress_for([day], season)[0]


def week_progress(day: date, season) -> list[DayProgress]:
    """Plan vs fact for Mon–Sat of the ISO week that contains `day`."""
    monday = day - timedelta(days=day.weekday())
    return _progress_for([monday + timedelta(days=i) for i in range(PLAN_DAYS)], season)


def export_done(p: DayProgress) -> bool:
    """daily_export: every plan row met, every export part packed, ≥1 export part."""
    return (
        p.export_parts >= 1
        and all(r.fact >= r.plan for r in p.rows)
        and p.export_parts_packed == p.export_parts
    )


def loading_done(p: DayProgress) -> bool:
    """daily_loading: packed trucks reach max(plan, export parts), and ≥1."""
    return p.packed >= 1 and p.packed >= p.loading_target


def progress_payload(p: DayProgress) -> dict:
    """The JSON day object shared by the endpoint and /me/tasks/ — ints only."""
    return {
        'date': p.date.isoformat(),
        'day_of_week': p.date.isoweekday(),
        'rows': [
            {'key': r.key, 'label': r.label, 'country_id': r.country_id,
             'is_gapy': r.is_gapy, 'plan': r.plan, 'fact': r.fact}
            for r in p.rows
        ],
        'plan_total': p.plan_total,
        'export_parts': p.export_parts,
        'export_parts_packed': p.export_parts_packed,
        'packed': p.packed,
        'loading_target': p.loading_target,
    }


def _progress_for(days: list[date], season) -> list[DayProgress]:
    # Every caller passes days of ONE ISO week (a single day, or Mon–Sat).
    if season is None:
        return [_assemble(d, {}, {}, 0) for d in days]
    plans = _plan_buckets(days, season)
    parts = _export_part_buckets(days, season)
    packed = _packed_counts(days, season)
    return [_assemble(d, plans.get(d, {}), parts.get(d, {}), packed.get(d, 0)) for d in days]


def _key(country_id: int | None, is_gapy: bool) -> str:
    return GAPY_KEY if is_gapy else f'country:{country_id}'


def _plan_buckets(days: list[date], season) -> dict[date, dict[str, _Bucket]]:
    year, week, _ = days[0].isocalendar()
    by_weekday = {d.isoweekday(): d for d in days}
    rows = (
        TruckDestinationSplit.objects
        .filter(
            truck_allocation__season=season, truck_allocation__year=year,
            truck_allocation__week_number=week,
            truck_allocation__day_of_week__in=list(by_weekday), truck_count__gt=0,
        )
        .order_by('destination__sort_order', 'destination__name')
        .values_list('truck_allocation__day_of_week', 'destination__country_id',
                     'destination__name', 'truck_count')
    )
    out: dict[date, dict[str, _Bucket]] = {}
    for dow, country_id, name, trucks in rows:
        is_gapy = country_id is None
        buckets = out.setdefault(by_weekday[dow], {})
        bucket = buckets.setdefault(_key(country_id, is_gapy), _Bucket(name, country_id, is_gapy))
        if name not in bucket.label.split(' + '):
            bucket.label = f'{bucket.label} + {name}'
        bucket.count += trucks
    return out


def _live(days: list[date], season):
    return (
        Shipment.objects
        .filter(date__in=days, season=season, is_archived=False, deleted_at__isnull=True)
        .exclude(status__code='cancelled')
        .order_by()  # strip Meta.ordering so it doesn't join the GROUP BY
    )


def _export_part_buckets(days: list[date], season) -> dict[date, dict[str, _Bucket]]:
    rows = (
        _live(days, season)
        .filter(country__isnull=False, customer__isnull=False)
        .values('date', 'country_id', 'country__name_en', 'country__name_tk', 'is_gapy_satys')
        .annotate(
            n=Count('id', distinct=True),
            n_packed=Count('id', distinct=True, filter=Q(block_sources__isnull=False)),
        )
    )
    out: dict[date, dict[str, _Bucket]] = {}
    for r in rows:
        is_gapy = r['is_gapy_satys']
        label = GAPY_LABEL if is_gapy else (r['country__name_en'] or r['country__name_tk'])
        country_id = None if is_gapy else r['country_id']
        bucket = out.setdefault(r['date'], {}).setdefault(
            _key(country_id, is_gapy), _Bucket(label, country_id, is_gapy),
        )
        bucket.count += r['n']
        bucket.packed += r['n_packed']
    return out


def _packed_counts(days: list[date], season) -> dict[date, int]:
    rows = (
        _live(days, season)
        .filter(block_sources__isnull=False)
        .values('date')
        .annotate(n=Count('id', distinct=True))
    )
    return {r['date']: r['n'] for r in rows}


def _assemble(day: date, plan: dict[str, _Bucket], parts: dict[str, _Bucket], packed: int) -> DayProgress:
    rows = [
        ProgressRow(key=k, label=b.label, country_id=b.country_id, is_gapy=b.is_gapy,
                    plan=b.count, fact=parts[k].count if k in parts else 0)
        for k, b in plan.items()
    ] + [
        ProgressRow(key=k, label=b.label, country_id=b.country_id, is_gapy=b.is_gapy,
                    plan=0, fact=b.count)
        for k, b in parts.items() if k not in plan
    ]
    plan_total = sum(r.plan for r in rows)
    export_parts = sum(b.count for b in parts.values())
    return DayProgress(
        date=day, rows=rows, plan_total=plan_total, export_parts=export_parts,
        export_parts_packed=sum(b.packed for b in parts.values()),
        packed=packed, loading_target=max(plan_total, export_parts),
    )
