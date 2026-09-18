"""Plan-change endpoints and the day-entry wire additions (ADR-024).

Usage:
    python manage.py test apps.greenhouse.tests.test_plan_change_api --verbosity=2
"""
from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.greenhouse.models import PlanChangeRequest
from apps.greenhouse.services.plan_change_service import request_plan_change
from apps.greenhouse.tests.plan_change_fixtures import IN_WEEK_UTC, build_world, frozen_now, make_entry

BASE = '/api/v1/greenhouse'


def _rows(response):
    return response.data['results'] if isinstance(response.data, dict) else response.data


class TestPlanChangeApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.w = build_world('PCAPI')

    def setUp(self):
        self.gm = self.w.users['greenhouse_manager']
        self.client = APIClient()

    def _as(self, role):
        self.client.force_authenticate(self.w.users[role])

    def test_in_week_manager_patch_returns_202_with_the_pending_change(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 11500}, format='json')
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.data['plan_value'], '10000.00')
        self.assertEqual(resp.data['plan_baseline_value'], '10000.00')
        self.assertEqual(resp.data['pending_change']['requested_value'], '11500.00')
        self.assertEqual(resp.data['pending_change']['change_pct'], '15.00')

    def test_patching_the_approved_value_back_withdraws_with_200(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 10000}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data['pending_change'])

    def test_out_of_range_patch_returns_400_with_the_range(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        self._as('greenhouse_manager')
        with frozen_now(IN_WEEK_UTC):
            resp = self.client.patch(f'{BASE}/day-entries/{entry.id}/', {'plan_value': 12000}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('8,500–11,500', resp.data['plan_value'])

    def test_list_filters_by_status_and_week(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        request_plan_change(entry, Decimal('10500'), self.gm)
        request_plan_change(entry, Decimal('11000'), self.gm)  # supersedes the first
        self._as('export_manager')
        pending = _rows(self.client.get(f'{BASE}/plan-change-requests/?status=pending&year=2026&week=24'))
        self.assertEqual([r['requested_value'] for r in pending], ['11000.00'])
        self.assertEqual(pending[0]['block_code'], self.w.block.code)
        self.assertEqual(pending[0]['requested_by_name'], self.gm.username)
        every = _rows(self.client.get(f'{BASE}/plan-change-requests/?year=2026&week=24'))
        self.assertEqual(len(every), 2)
        other_week = _rows(self.client.get(f'{BASE}/plan-change-requests/?year=2026&week=25'))
        self.assertEqual(other_week, [])

    def test_export_manager_approves_via_the_api(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {'note': 'ok'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'approved')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('11000'))

    def test_export_manager_rejects_via_the_api(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/reject/', {}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'rejected')

    def test_document_team_gets_403(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('document_team')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertIn('error', resp.data)

    def test_deciding_twice_returns_400(self):
        entry = make_entry(self.w, plan_value=Decimal('10000'))
        change = request_plan_change(entry, Decimal('11000'), self.gm)
        self._as('export_manager')
        self.client.post(f'{BASE}/plan-change-requests/{change.id}/approve/', {}, format='json')
        resp = self.client.post(f'{BASE}/plan-change-requests/{change.id}/reject/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['error'], 'Request is no longer pending.')

    def test_day_entries_list_query_count_does_not_grow_with_pending_changes(self):
        url = f'{BASE}/day-entries/?weekly_plan={self.w.plan.id}'
        self._as('export_manager')
        first = make_entry(self.w, weekday=0, plan_value=Decimal('100'))
        PlanChangeRequest.objects.create(entry=first, requested_value=Decimal('105'), requested_by=self.gm)
        with CaptureQueriesContext(connection) as one:
            self.client.get(url)
        for weekday in (1, 2):
            e = make_entry(self.w, weekday=weekday, plan_value=Decimal('100'))
            PlanChangeRequest.objects.create(entry=e, requested_value=Decimal('105'), requested_by=self.gm)
        with CaptureQueriesContext(connection) as three:
            resp = self.client.get(url)
        rows = _rows(resp)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r['pending_change'] for r in rows))
        self.assertEqual(len(one), len(three))
