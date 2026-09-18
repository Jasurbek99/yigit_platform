"""PlanChangeRequest model + GreenhouseConfig.plan_change_max_pct (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_model --verbosity=2
"""
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.models import GreenhouseConfig
from apps.core.serializers import GreenhouseConfigSerializer
from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.tests.plan_change_fixtures import build_world, make_entry


class TestPlanChangeRequestModel(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCM')

    def test_a_cell_can_hold_only_one_pending_request(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('11000'))

    def test_decided_requests_do_not_count_toward_the_one_pending_rule(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        for status in ('superseded', 'rejected', 'approved'):
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'), status=status)
        PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10600'))
        self.assertEqual(entry.change_requests.count(), 4)

    def test_negative_requested_value_is_rejected_by_db(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        with self.assertRaises(IntegrityError), transaction.atomic():
            PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('-1'))

    def test_freeze_season_is_the_entry_season(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = PlanChangeRequest.objects.create(entry=entry, requested_value=Decimal('10500'))
        self.assertEqual(change.freeze_season, self.w.season)

    def test_baseline_column_defaults_to_null(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        entry.refresh_from_db()
        self.assertIsNone(entry.plan_baseline_value)


class TestPlanChangeCapConfig(TestCase):
    def test_default_cap_is_15_percent(self):
        self.assertEqual(GreenhouseConfig.get_solo().plan_change_max_pct, Decimal('15.00'))

    def test_cap_is_exposed_on_the_config_api(self):
        data = GreenhouseConfigSerializer(GreenhouseConfig.get_solo()).data
        self.assertEqual(data['plan_change_max_pct'], '15.00')
