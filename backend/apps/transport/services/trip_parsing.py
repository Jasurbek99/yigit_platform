"""Planning trip JSON → ExternalTrip field dict, and visa-name → country codes."""
import unicodedata
from datetime import date
from uuid import UUID

from django.utils.dateparse import parse_date, parse_datetime

# Planning spells some countries differently from core.Country.name_tk.
VISA_NAME_ALIASES = {'OZBEGISTAN': 'UZ'}


def _norm(value: str) -> str:
    ascii_only = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode()
    return ''.join(ch for ch in ascii_only.upper() if ch.isalnum())


def _date_or_none(value: str | None) -> date | None:
    return parse_date(value) if value else None


def parse_trip(item: dict) -> dict:
    tractor, trailer, driver = item['tractor'], item['trailer'], item['driver']
    passport = driver.get('foreignPassport') or {}
    visas = ';'.join(f"{v['country']}:{v['expiryDate']}" for v in driver.get('visas') or [])
    return {
        'integration_trip_id': UUID(item['integrationTripId']),
        'trip_number': item.get('tripNumber'),
        'status': item['status'],
        'planned_departure': parse_date(item['plannedDeparture']),
        'changed_at': parse_datetime(item['changedAt']),
        'destination_country_code': item.get('destinationCountryCode'),
        'tractor_plate': tractor['plateNumber'],
        'tractor_brand': tractor.get('brand'),
        'tractor_model': tractor.get('model'),
        'tractor_company': tractor.get('companyName'),
        'tractor_source': tractor['source'],
        'trailer_plate': trailer['plateNumber'],
        'trailer_brand': trailer.get('brand'),
        'trailer_model': trailer.get('model'),
        'trailer_company': trailer.get('companyName'),
        'trailer_source': trailer['source'],
        'driver_full_name': driver['fullName'],
        'driver_phone': driver.get('phone'),
        'driver_passport_number': passport.get('seriesNumber'),
        'driver_passport_expiry': _date_or_none(passport.get('expiryDate')),
        'driver_visas': visas[:500],
        'driver_source': driver['source'],
    }


def visa_country_codes(visas_csv: str) -> list[str]:
    """Codes of countries the driver holds a visa for; unknown names are dropped."""
    from apps.core.models import Country

    by_name = {_norm(c.name_tk): c.code for c in Country.objects.exclude(code__isnull=True)}
    codes: list[str] = []
    for chunk in filter(None, (visas_csv or '').split(';')):
        name = chunk.rsplit(':', 1)[0]
        code = VISA_NAME_ALIASES.get(_norm(name)) or by_name.get(_norm(name))
        if code:
            codes.append(code)
    return codes
