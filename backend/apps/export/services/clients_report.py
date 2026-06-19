"""Clients Report aggregation — replicates the legacy `by_clients.xlsx` workbook.

Reproduces, live from `export.shipments`, the three aggregations the business
used to maintain by hand in `data/by_clients.xlsx`:

 1. Client x Month truck dispatch (rows = customer+country, cols = season months),
    with per-row totals, % share, and real tonnage from Sum(weight_net).
 2. Trucks (+ tonnage) by destination country.
 3. Trucks (+ tonnage) by destination city.

Customers that ship to more than one country appear once per country — this is
how the spreadsheet's "Begjan" vs "Begjan-Rossiya" split is reproduced.

MSSQL rules enforced:
 - TruncMonth for monthly buckets (MSSQL-safe via Django ORM)
 - DecimalField arithmetic only — float cast happens at the JSON boundary
 - No JSONField / ArrayField / DISTINCT ON
"""
import logging
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth, Coalesce

logger = logging.getLogger(__name__)

_KG_PER_TON = Decimal('1000')


def _month_axis(start, end) -> list[dict]:
    """Return the ordered list of months spanning the season, inclusive.

    Args:
        start: Season start date.
        end: Season end date.

    Returns:
        List of {'key': 'YYYY-MM', 'year': int, 'month': int} dicts. The
        frontend localizes the human-readable label from year+month.
    """
    months: list[dict] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append({'key': f'{year:04d}-{month:02d}', 'year': year, 'month': month})
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return months


def _tons(kg: Decimal) -> float:
    """Convert a kg Decimal to tonnes as a JSON-ready float."""
    return float((kg or Decimal('0')) / _KG_PER_TON)


def build_clients_report(season) -> dict:
    """Build the full clients report for a season.

    Args:
        season: A `core.Season` instance (must expose start_date/end_date).

    Returns:
        Dict with keys: season, months, clients, totals, by_country, by_city.
        Returns an empty-but-valid shape when `season` is None.
    """
    if season is None:
        return {
            'season': None,
            'months': [],
            'clients': [],
            'totals': {'monthly': {}, 'total_trucks': 0, 'total_tonnage': 0.0},
            'by_country': [],
            'by_city': [],
        }

    from apps.export.models import Shipment  # lazy import — avoids circular risk

    start, end = season.start_date, season.end_date
    months = _month_axis(start, end)
    month_keys = [m['key'] for m in months]

    base = Shipment.objects.filter(date__gte=start, date__lte=end)

    clients = _build_clients(base, month_keys)
    grand_trucks = sum(c['total_trucks'] for c in clients)
    grand_tonnage_kg = sum(c['_tonnage_kg'] for c in clients)

    # Per-row % share + strip the internal kg accumulator.
    for row in clients:
        row['pct'] = (
            round(row['total_trucks'] / grand_trucks * 100, 1) if grand_trucks else 0.0
        )
        row.pop('_tonnage_kg', None)

    return {
        'season': {'id': season.id, 'name': season.name},
        'months': months,
        'clients': clients,
        'totals': _build_totals(clients, month_keys, grand_trucks, grand_tonnage_kg),
        'by_country': _build_by_country(base),
        'by_city': _build_by_city(base),
    }


def _build_clients(base, month_keys: list[str]) -> list[dict]:
    """Pivot shipments into customer x country rows with a per-month breakdown."""
    rows = (
        base.filter(customer__isnull=False)
        .annotate(month=TruncMonth('date'))
        .values('customer_id', 'customer__name', 'country_id', 'country__name_en', 'month')
        .annotate(
            trucks=Count('id'),
            tonnage_kg=Coalesce(Sum('weight_net'), Decimal('0')),
        )
        .order_by('customer__name')
    )

    pivot: dict[tuple, dict] = {}
    month_kg: dict[tuple, dict[str, Decimal]] = {}
    for r in rows:
        key = (r['customer_id'], r['country_id'])
        entry = pivot.get(key)
        if entry is None:
            entry = {
                'customer_id': r['customer_id'],
                'customer_name': r['customer__name'],
                'country_id': r['country_id'],
                'country_name': r['country__name_en'] or '',
                'monthly': {mk: {'trucks': 0, 'tonnage': 0.0} for mk in month_keys},
                'total_trucks': 0,
                'total_tonnage': 0.0,
                '_tonnage_kg': Decimal('0'),
            }
            pivot[key] = entry
            month_kg[key] = {mk: Decimal('0') for mk in month_keys}

        month_key = r['month'].strftime('%Y-%m') if r['month'] else None
        kg = r['tonnage_kg'] or Decimal('0')
        if month_key in entry['monthly']:
            entry['monthly'][month_key]['trucks'] += r['trucks']
            month_kg[key][month_key] += kg
        entry['total_trucks'] += r['trucks']
        entry['_tonnage_kg'] += kg

    result = list(pivot.values())
    for entry in result:
        key = (entry['customer_id'], entry['country_id'])
        for mk in month_keys:
            entry['monthly'][mk]['tonnage'] = _tons(month_kg[key][mk])
        entry['total_tonnage'] = _tons(entry['_tonnage_kg'])
    result.sort(key=lambda e: e['total_trucks'], reverse=True)
    return result


def _build_totals(clients: list[dict], month_keys: list[str],
                  grand_trucks: int, grand_tonnage_kg: Decimal) -> dict:
    """Aggregate the per-month and grand totals for the table footer."""
    monthly: dict[str, dict] = {
        mk: {'trucks': 0, 'tonnage': 0.0} for mk in month_keys
    }
    for row in clients:
        for mk in month_keys:
            cell = row['monthly'][mk]
            monthly[mk]['trucks'] += cell['trucks']
            monthly[mk]['tonnage'] = round(monthly[mk]['tonnage'] + cell['tonnage'], 3)
    return {
        'monthly': monthly,
        'total_trucks': grand_trucks,
        'total_tonnage': _tons(grand_tonnage_kg),
    }


def _build_by_country(base) -> list[dict]:
    """Trucks + tonnage grouped by destination country."""
    rows = (
        base.filter(country__isnull=False)
        .values('country__name_en')
        .annotate(
            trucks=Count('id'),
            tonnage_kg=Coalesce(Sum('weight_net'), Decimal('0')),
        )
        .order_by('-trucks')
    )
    return [
        {
            'name': r['country__name_en'] or '',
            'trucks': r['trucks'],
            'tonnage': _tons(r['tonnage_kg']),
        }
        for r in rows
    ]


def _build_by_city(base) -> list[dict]:
    """Trucks + tonnage grouped by destination city (null/empty cities omitted)."""
    rows = (
        base.filter(city__isnull=False)
        .values('city__name')
        .annotate(
            trucks=Count('id'),
            tonnage_kg=Coalesce(Sum('weight_net'), Decimal('0')),
        )
        .order_by('-trucks')
    )
    return [
        {
            'name': r['city__name'],
            'trucks': r['trucks'],
            'tonnage': _tons(r['tonnage_kg']),
        }
        for r in rows
        if r['city__name']
    ]
