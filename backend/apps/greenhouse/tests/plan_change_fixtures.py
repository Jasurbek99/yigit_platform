"""Shared fixtures for the plan-change-request test modules (ADR-024).

The plan week under test is ISO 2026-W24 = Mon 2026-06-08 … Sun 2026-06-14,
Asia/Ashgabat (UTC+5). `frozen_now` pins `timezone.now()` inside
harvest_day_service, the module `set_plan_value()` reads the clock from.
"""
from contextlib import contextmanager
from datetime import date, datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model

from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
from apps.greenhouse.models import BlockManagerAssignment, HarvestDayEntry, WeeklyHarvestPlan

WEEK = (2026, 24)
BEFORE_WEEK_UTC = datetime(2026, 6, 5, 7, 0, tzinfo=dt_timezone.utc)   # Fri 12:00 local — week not started
IN_WEEK_UTC = datetime(2026, 6, 10, 7, 0, tzinfo=dt_timezone.utc)      # Wed 12:00 local — week started
AFTER_WEEK_UTC = datetime(2026, 6, 14, 19, 1, tzinfo=dt_timezone.utc)  # Mon 00:01 local of W25 — week ended

ROLES = ('greenhouse_manager', 'export_manager', 'admin', 'boss', 'director', 'document_team')


def build_world(prefix: str) -> SimpleNamespace:
    """Season, block, W24 plan container, one user per role, and the manager's block assignment."""
    User = get_user_model()
    GreenhouseConfig.get_solo()
    season, _ = Season.objects.get_or_create(
        name=f'{prefix}-S',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-08-31', 'is_active': True},
    )
    block, _ = GreenhouseBlock.objects.get_or_create(
        code=f'{prefix}-A', defaults={'name': f'{prefix} Block A', 'is_active': True},
    )
    users = {
        role: User.objects.create_user(username=f'{prefix}_{role}', password='pass', role=role)
        for role in ROLES
    }
    BlockManagerAssignment.objects.create(user=users['greenhouse_manager'], block=block, is_active=True)
    plan, _ = WeeklyHarvestPlan.objects.get_or_create(
        season=season, block=block, year=WEEK[0], week_number=WEEK[1],
    )
    return SimpleNamespace(season=season, block=block, plan=plan, users=users)


def make_entry(world, weekday: int = 0, plan_value=None, baseline=None, plan_state: str = '') -> HarvestDayEntry:
    """One W24 day cell for the world's block."""
    return HarvestDayEntry.objects.create(
        weekly_plan=world.plan,
        season=world.season,
        block=world.block,
        entry_date=date.fromisocalendar(WEEK[0], WEEK[1], weekday + 1),
        weekday=weekday,
        plan_value=plan_value,
        plan_baseline_value=baseline,
        plan_state=plan_state,
    )


@contextmanager
def frozen_now(now_utc: datetime):
    """Pin `timezone.now()` inside harvest_day_service for the duration of the block."""
    with patch('apps.greenhouse.services.harvest_day_service.timezone') as mock_tz:
        mock_tz.now.return_value = now_utc
        mock_tz.utc = dt_timezone.utc
        yield
