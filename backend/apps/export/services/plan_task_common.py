"""Helpers shared by the planning tasks (weekly plan, truck allocation, reviews,
daily loading / export). Spec: docs/superpowers/specs/2026-09-29-planning-tasks-design.md.

Days are greenhouse-local (GreenhouseConfig.timezone_name — the clock
run_weekly_plan_setup already uses). Counts snapshots are ASCII "k:v;..." strings
because Task cannot hold JSON on MSSQL.
"""
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone


def local_tz() -> ZoneInfo:
    from apps.core.models import GreenhouseConfig

    return ZoneInfo(GreenhouseConfig.get_solo().timezone_name)


def local_today(now: datetime | None = None) -> date:
    return (now or timezone.now()).astimezone(local_tz()).date()


def end_of_local_day(day: date) -> datetime:
    """23:59:59 local on `day` — a task with this deadline turns red after it."""
    return datetime.combine(day, time(23, 59, 59), tzinfo=local_tz())


def next_iso_week(today: date) -> tuple[int, int]:
    """(ISO year, ISO week) of the week after the one containing `today`."""
    year, week, _ = (today + timedelta(days=7)).isocalendar()
    return year, week


def iso_monday(year: int, week: int) -> date:
    return date.fromisocalendar(year, week, 1)


def encode_counts(counts: Mapping[tuple[int, ...], int]) -> str:
    """{(1, 5): 2, (3, 7): 1} → "1:5:2;3:7:1". Zero counts dropped and keys
    sorted, so two equal maps always encode to the same string."""
    return ';'.join(
        ':'.join(str(part) for part in (*key, n))
        for key, n in sorted(counts.items()) if n
    )


EMPTY_BASELINE = ';'


def encode_baseline(counts: Mapping[tuple[int, ...], int]) -> str:
    """encode_counts, but a recorded empty map is ';', never ''.

    '' on a truck_allocation task means "no baseline recorded yet" (a task from
    before this feature, adopted on first sync). A plan that genuinely needs no
    trucks must stay distinguishable from that, or a later increase would be
    adopted silently instead of raising a review. decode_counts(';') == {}.
    """
    return encode_counts(counts) or EMPTY_BASELINE


def decode_counts(text: str) -> dict[tuple[int, ...], int]:
    out: dict[tuple[int, ...], int] = {}
    for chunk in filter(None, text.split(';')):
        *key, n = (int(part) for part in chunk.split(':'))
        out[tuple(key)] = n
    return out
