"""A closed season is immutable (D1) — the write freeze.

Two layers are under test:

  Layer 1  `apps.core.permissions.SeasonNotClosed` — a DRF object permission.
           Covers every write that goes through ``get_object()``.
  Layer 2  `assert_season_open` / `assert_bulk_seasons_open` inside the service
           and action bodies. Covers the writes that structurally cannot reach
           layer 1: `transition_to()`, `create_shipment(season=…)`, the two-row
           Join's *source* half, and every bulk action that selects rows by a
           raw id list (bulk-delete, sheet-order, quota-usage approve,
           local-sell bulk-submit/approve, the two initialize-week endpoints,
           destination set, harvest bulk late-edit).

Both layers surface as ``409 {"error": "season_closed", "season", "closed_at"}``
via `apps.core.exceptions.custom_exception_handler`.

Run with:
    DJANGO_TESTING=true python manage.py test apps.export.tests_season_freeze
"""
from datetime import date
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.contracts.models import Contract, ContractSale
from apps.core.models import (
    Country, Customer, ExportFirm, GreenhouseBlock, ImportFirm,
    RoleResourcePermission, Season, ShipmentStatusType, TruckDestination, User,
)
from apps.core.seasons import SeasonClosedError
from apps.export.models import (
    CustomsExpense, QuotaUsageRecord, Shipment, ShipmentBlockSource,
    ShipmentComment, Task, WeeklyDestinationSelection, WeeklyLocalSellPlan,
    WeeklyTruckAllocation,
)
from apps.export.services.shipment import create_shipment, transition_to
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

# (code, step_order, name_tk, name_en, name_ru, required_role, phase) — the
# canonical rows from core.migrations.0010_state_machine_v2. That migration
# skips seeding under DJANGO_TESTING=true, so the fixtures below must
# get_or_create (never create) and must match it byte-for-byte, otherwise the
# fixture state differs depending on the env var. See tests_season_scoping.
_STATUS_ROWS = {
    'draft': ('Garalama', 'Draft', 'Черновик', 'warehouse_chief', 'DRAFT', 0),
    'gumruk_girish': (
        'Gümrük girizilmesi', 'Customs Entry', 'Передача документов на таможню',
        'document_team', 'CUSTOMS', 1,
    ),
}


def _make_status(code: str) -> ShipmentStatusType:
    """get_or_create a canonical ShipmentStatusType row keyed on `code`."""
    name_tk, name_en, name_ru, required_role, phase, step_order = _STATUS_ROWS[code]
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': name_tk, 'name_en': name_en, 'name_ru': name_ru,
            'phase': phase, 'step_order': step_order, 'required_role': required_role,
        },
    )
    return status


class SeasonFreezeFixture(TestCase):
    """Shared two-season fixture: one closed season, one active season."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.draft = _make_status('draft')
        cls.next_status = _make_status('gumruk_girish')
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        cls.customer = Customer.objects.create(name='Buyer', default_country=cls.country)
        cls.block = GreenhouseBlock.objects.create(code='A', name='Block A')
        cls.export_firm = ExportFirm.objects.create(code='EF1', name_tk='Firma')
        cls.import_firm = ImportFirm.objects.create(name_company='Buyer LLC')
        cls.destination = TruckDestination.objects.create(name='Almaty')

        # role='admin' + is_superuser: passes every role gate in the bodies
        # under test, so a 409 can only come from the season guard.
        cls.admin = User.objects.create(
            username='freeze-adm', role='admin', is_superuser=True,
        )
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='closed_season', defaults={'can_view': True},
        )

    @classmethod
    def make_shipment(cls, season: Season, code: str, *, joinable: bool = False) -> Shipment:
        """Create a draft shipment in `season`.

        Args:
            season: The season to stamp the row with.
            code: Unique shipment_code.
            joinable: When True also attach customer + one block source, which
                is what `transition_to()`'s two-row-join guard requires before
                a draft may leave 'draft'.
        """
        shipment = Shipment.objects.create(
            shipment_code=code, date=season.start_date, season=season,
            status=cls.draft, country=cls.country,
            customer=cls.customer if joinable else None,
        )
        if joinable:
            ShipmentBlockSource.objects.create(
                shipment=shipment, block=cls.block, weight_kg=Decimal('1000'),
            )
        return shipment

    def client_as(self, user=None) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user or self.admin)
        return client

    def assert_season_closed_409(self, response) -> None:
        """Assert the full 409 contract, not just the status code."""
        self.assertEqual(response.status_code, 409, response.content[:400])
        body = response.json()
        self.assertEqual(body['error'], 'season_closed')
        self.assertEqual(body['season'], '2025/2026')
        self.assertIsNotNone(body['closed_at'])


# ── Layer 2: the service guards ─────────────────────────────────────────────

class TransitionFreezeTests(SeasonFreezeFixture):
    """`transition_to()` is the mandated path for every status change."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.frozen = cls.make_shipment(cls.closed, 'CLS-T01', joinable=True)
        cls.live = cls.make_shipment(cls.active, 'ACT-T01', joinable=True)

    def test_transition_on_closed_season_raises(self):
        with self.assertRaises(SeasonClosedError) as ctx:
            transition_to(self.frozen, 'gumruk_girish', self.admin)
        self.assertEqual(ctx.exception.season, self.closed)
        self.frozen.refresh_from_db()
        self.assertEqual(self.frozen.status.code, 'draft')

    def test_transition_on_active_season_still_works(self):
        transition_to(self.live, 'gumruk_girish', self.admin)
        self.live.refresh_from_db()
        self.assertEqual(self.live.status.code, 'gumruk_girish')

    def test_create_shipment_into_closed_season_raises(self):
        with self.assertRaises(SeasonClosedError):
            create_shipment(
                shipment_code='CLS-NEW/25', date=self.closed.start_date,
                user=self.admin, season=self.closed,
            )
        self.assertFalse(Shipment.objects.filter(shipment_code='CLS-NEW/25').exists())

    def test_create_shipment_into_active_season_still_works(self):
        shipment = create_shipment(
            shipment_code='ACT-NEW/26', date=self.active.start_date,
            user=self.admin, season=self.active,
        )
        self.assertEqual(shipment.season, self.active)


# ── Layer 1: the ShipmentViewSet API contract ───────────────────────────────

class ShipmentApiFreezeTests(SeasonFreezeFixture):

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.frozen = cls.make_shipment(cls.closed, 'CLS-A01', joinable=True)
        cls.live = cls.make_shipment(cls.active, 'ACT-A01', joinable=True)

    def test_patch_closed_season_shipment_returns_409(self):
        response = self.client_as().patch(
            f'/api/v1/export/shipments/{self.frozen.pk}/?season={self.closed.pk}',
            {'notes': 'edit attempt'}, format='json',
        )
        self.assert_season_closed_409(response)
        self.frozen.refresh_from_db()
        self.assertNotEqual(self.frozen.notes, 'edit attempt')

    def test_patch_closed_season_shipment_without_season_param_returns_409(self):
        """The frontend omits ?season= when the selection equals the active
        season, so the guard must read obj.season — never the query param."""
        response = self.client_as().patch(
            f'/api/v1/export/shipments/{self.frozen.pk}/',
            {'notes': 'edit attempt'}, format='json',
        )
        self.assert_season_closed_409(response)

    def test_patch_active_season_shipment_still_works(self):
        response = self.client_as().patch(
            f'/api/v1/export/shipments/{self.live.pk}/',
            {'notes': 'fine'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.live.refresh_from_db()
        self.assertEqual(self.live.notes, 'fine')

    def test_transition_endpoint_on_closed_season_returns_409(self):
        response = self.client_as().post(
            f'/api/v1/export/shipments/{self.frozen.pk}/transition/',
            {'new_status': 'gumruk_girish'}, format='json',
        )
        self.assert_season_closed_409(response)

    def test_soft_delete_on_closed_season_returns_409(self):
        """`soft_delete` is in ShipmentViewSet._OPEN_ACTIONS, whose
        get_permissions() branch returns its own permission list — adding
        SeasonNotClosed to the class attribute alone would not cover it."""
        response = self.client_as().post(
            f'/api/v1/export/shipments/{self.frozen.pk}/soft-delete/', {}, format='json',
        )
        self.assert_season_closed_409(response)
        self.frozen.refresh_from_db()
        self.assertIsNone(self.frozen.deleted_at)

    def test_soft_delete_on_active_season_still_works(self):
        response = self.client_as().post(
            f'/api/v1/export/shipments/{self.live.pk}/soft-delete/', {}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])

    def test_manifest_close_on_closed_season_returns_409(self):
        """Second get_permissions() branch: the pallet-manifest writes."""
        response = self.client_as().post(
            f'/api/v1/export/shipments/{self.frozen.pk}/manifest/close/', {}, format='json',
        )
        self.assert_season_closed_409(response)

    def test_reading_a_closed_season_shipment_is_still_allowed(self):
        """The freeze is write-only — Rule A direct links must still resolve."""
        response = self.client_as().get(f'/api/v1/export/shipments/{self.frozen.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['shipment_code'], 'CLS-A01')

    def test_post_shipment_with_closed_season_in_body_returns_409(self):
        """Creates are stamped with the active season, so no request-level
        check is needed — but a body carrying an explicit closed `season` is
        caught by the create service (layer 2)."""
        response = self.client_as().post(
            '/api/v1/export/shipments/',
            {
                'shipment_code': '0109999/25', 'date': '2025-10-01',
                'season': self.closed.pk, 'country': self.country.pk,
                'customer': self.customer.pk,
            },
            format='json',
        )
        self.assert_season_closed_409(response)


class ShipmentBulkFreezeTests(SeasonFreezeFixture):
    """Writes that select shipments by a raw id list or a body FK — no
    `get_object()`, so layer 1 structurally cannot see them."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.frozen = cls.make_shipment(cls.closed, 'CLS-B01', joinable=True)
        cls.live = cls.make_shipment(cls.active, 'ACT-B01', joinable=True)

    def test_bulk_delete_of_closed_season_shipment_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/shipments/bulk-delete/',
            {'ids': [self.frozen.pk]}, format='json',
        )
        self.assert_season_closed_409(response)
        self.assertTrue(Shipment.objects.filter(pk=self.frozen.pk).exists())

    def test_bulk_delete_of_active_season_shipment_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/shipments/bulk-delete/',
            {'ids': [self.live.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertFalse(Shipment.objects.filter(pk=self.live.pk).exists())

    def test_bulk_delete_rejects_a_mixed_batch_wholesale(self):
        """One frozen id poisons the batch — nothing is deleted."""
        response = self.client_as().post(
            '/api/v1/export/shipments/bulk-delete/',
            {'ids': [self.live.pk, self.frozen.pk]}, format='json',
        )
        self.assert_season_closed_409(response)
        self.assertTrue(Shipment.objects.filter(pk=self.live.pk).exists())

    def test_sheet_order_touching_a_closed_season_shipment_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/shipments/sheet-order/',
            {'shipment_ids': [self.frozen.pk]}, format='json',
        )
        self.assert_season_closed_409(response)

    def test_sheet_order_on_active_season_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/shipments/sheet-order/',
            {'shipment_ids': [self.live.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()['updated'], 1)

    def test_join_with_a_closed_season_source_returns_409(self):
        """The target reaches layer 1 through get_object(); the source comes
        from the request body and needs the explicit guard."""
        target = Shipment.objects.create(
            shipment_code='ACT-JOIN-T', date=self.active.start_date,
            season=self.active, status=self.draft,
            country=self.country, customer=self.customer,
        )
        response = self.client_as().post(
            f'/api/v1/export/shipments/{target.pk}/join/',
            {'source_id': self.frozen.pk}, format='json',
        )
        self.assert_season_closed_409(response)
        self.assertTrue(Shipment.objects.filter(pk=self.frozen.pk).exists())

    def test_swap_with_a_closed_season_partner_returns_409(self):
        response = self.client_as().post(
            f'/api/v1/export/shipments/{self.live.pk}/swap/',
            {'other_id': self.frozen.pk, 'fields': ['truck_plate']}, format='json',
        )
        self.assert_season_closed_409(response)


# ── Layer 1 across every viewset scoped in Tasks 5 and 6 ────────────────────

class ScopedViewSetFreezeTests(SeasonFreezeFixture):
    """One object-level write per scoped viewset.

    The active-season control asserts `!= 409` rather than `== 200`: each of
    these viewsets has its own role gate and serializer validation, so a
    bespoke valid payload per endpoint would be needed to assert 200 and would
    test those gates rather than the freeze. `!= 409` still discriminates a
    guard that fires on open seasons.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.shipments = {
            season: cls.make_shipment(season, f'S-{season.pk}')
            for season in (cls.active, cls.closed)
        }
        cls.rows = {
            season: {
                'truck_allocation': WeeklyTruckAllocation.objects.create(
                    season=season, week_number=1, year=season.start_date.year,
                    day_of_week=1,
                ),
                'local_sell_plan': WeeklyLocalSellPlan.objects.create(
                    season=season, export_firm=cls.export_firm,
                    week_number=1, year=season.start_date.year,
                ),
                'harvest_plan': WeeklyHarvestPlan.objects.create(
                    season=season, block=cls.block, week_number=1,
                    year=season.start_date.year,
                ),
                'day_entry': cls._make_day_entry(season),
                'contract': Contract.objects.create(
                    contract_number=f'C-{season.pk}', season=season,
                    export_firm=cls.export_firm, import_firm=cls.import_firm,
                    status=Contract.STATUS_ACTIVE,
                ),
                'comment': ShipmentComment.objects.create(
                    shipment=cls.shipments[season], user=cls.admin,
                    content=f'note-{season.pk}',
                ),
                'task': Task.objects.create(
                    shipment=cls.shipments[season], title_key=f't.{season.pk}',
                    assignee_role='export_manager',
                ),
                'quota_usage': QuotaUsageRecord.objects.create(
                    usage_date=season.start_date, export_firm=cls.export_firm,
                    kg_used=Decimal('1000'), shipment=cls.shipments[season],
                ),
                'customs_expense': CustomsExpense.objects.create(
                    expense_date=season.start_date, category='OTHER',
                    amount=Decimal('10'), shipment=cls.shipments[season],
                    created_by=cls.admin,
                ),
                'contract_sale': ContractSale.objects.create(
                    contract=Contract.objects.create(
                        contract_number=f'CS-{season.pk}', season=season,
                        export_firm=cls.export_firm, import_firm=cls.import_firm,
                        status=Contract.STATUS_ACTIVE,
                    ),
                    shipment=cls.shipments[season], invoice_number=season.pk,
                ),
            }
            for season in (cls.active, cls.closed)
        }

    @classmethod
    def _make_day_entry(cls, season: Season) -> HarvestDayEntry:
        plan = WeeklyHarvestPlan.objects.create(
            season=season, block=cls.block, week_number=2,
            year=season.start_date.year,
        )
        return HarvestDayEntry.objects.create(
            weekly_plan=plan, season=season, block=cls.block,
            entry_date=season.start_date, weekday=season.start_date.weekday(),
        )

    # (row key, url template, method, payload)
    CASES = [
        ('truck_allocation', '/api/v1/export/truck-allocations/{pk}/', 'patch',
         {'total_planned_kg': '999.00'}),
        ('local_sell_plan', '/api/v1/export/local-sell-plans/{pk}/', 'patch',
         {'monday_plan_kg': '10.00'}),
        ('harvest_plan', '/api/v1/greenhouse/harvest-plans/{pk}/', 'patch',
         {'notes': 'x'}),
        ('day_entry', '/api/v1/greenhouse/day-entries/{pk}/', 'patch',
         {'plan_value': '5.00'}),
        ('contract', '/api/v1/contracts/contracts/{pk}/', 'patch',
         {'notes': 'x'}),
        ('comment', '/api/v1/export/comments/{pk}/', 'patch',
         {'content': 'edited'}),
        ('task', '/api/v1/export/tasks/{pk}/start/', 'post', {}),
        ('quota_usage', '/api/v1/export/quota-usage/{pk}/', 'patch',
         {'kg_used': '50.00'}),
        ('customs_expense', '/api/v1/export/customs-expenses/{pk}/', 'patch',
         {'amount': '11.00'}),
        ('contract_sale', '/api/v1/contracts/sales/{pk}/', 'patch',
         {'notes': 'x'}),
    ]

    def _send(self, url: str, method: str, payload: dict):
        return getattr(self.client_as(), method)(url, payload, format='json')

    def test_closed_season_object_writes_return_409(self):
        for key, template, method, payload in self.CASES:
            with self.subTest(resource=key):
                url = template.format(pk=self.rows[self.closed][key].pk)
                self.assert_season_closed_409(self._send(url, method, payload))

    def test_active_season_object_writes_are_not_frozen(self):
        for key, template, method, payload in self.CASES:
            with self.subTest(resource=key):
                url = template.format(pk=self.rows[self.active][key].pk)
                response = self._send(url, method, payload)
                self.assertNotEqual(
                    response.status_code, 409,
                    f'{key}: the guard fired on an OPEN season',
                )

    def test_closed_season_object_reads_still_work(self):
        for key, template, _method, _payload in self.CASES:
            if key == 'task':
                continue  # /start/ is a write-only action, no GET counterpart
            with self.subTest(resource=key):
                url = template.format(pk=self.rows[self.closed][key].pk)
                self.assertEqual(self.client_as().get(url).status_code, 200)


# ── Carried-forward: bulk / body-season write actions ──────────────────────

class BulkActionFreezeTests(SeasonFreezeFixture):
    """detail=False POST actions that mutate by id list or by a body `season`.

    Named in the Task 5/6 reviews as deferred to this task:
    `QuotaUsageViewSet.approve`, `initialize_week` (both apps), `set_selection`,
    and the local-sell `bulk_*` pair. `bulk_grant/revoke_late_edit` were found
    here and are the same shape.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.shipments = {
            season: cls.make_shipment(season, f'BA-{season.pk}')
            for season in (cls.active, cls.closed)
        }
        cls.quota_rows = {
            season: QuotaUsageRecord.objects.create(
                usage_date=season.start_date, export_firm=cls.export_firm,
                kg_used=Decimal('1000'), shipment=cls.shipments[season],
                status='draft',
            )
            for season in (cls.active, cls.closed)
        }
        cls.sell_plans = {
            season: WeeklyLocalSellPlan.objects.create(
                season=season, export_firm=cls.export_firm,
                week_number=3, year=season.start_date.year,
                monday_plan_kg=Decimal('100'), status='submitted',
            )
            for season in (cls.active, cls.closed)
        }
        cls.harvest_plans = {
            season: WeeklyHarvestPlan.objects.create(
                season=season, block=cls.block, week_number=4,
                year=season.start_date.year,
            )
            for season in (cls.active, cls.closed)
        }

    def test_quota_usage_approve_of_closed_season_row_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/quota-usage/approve/',
            {'ids': [self.quota_rows[self.closed].pk]}, format='json',
        )
        self.assert_season_closed_409(response)
        self.quota_rows[self.closed].refresh_from_db()
        self.assertEqual(self.quota_rows[self.closed].status, 'draft')

    def test_quota_usage_approve_of_active_season_row_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/quota-usage/approve/',
            {'ids': [self.quota_rows[self.active].pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()['approved'], 1)

    def test_local_sell_bulk_approve_of_closed_season_row_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/local-sell-plans/bulk-approve/',
            {'ids': [self.sell_plans[self.closed].pk]}, format='json',
        )
        self.assert_season_closed_409(response)
        self.sell_plans[self.closed].refresh_from_db()
        self.assertEqual(self.sell_plans[self.closed].status, 'submitted')

    def test_local_sell_bulk_approve_of_active_season_row_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/local-sell-plans/bulk-approve/',
            {'ids': [self.sell_plans[self.active].pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()['approved'], [self.sell_plans[self.active].pk])

    def test_local_sell_bulk_submit_of_closed_season_row_returns_409(self):
        WeeklyLocalSellPlan.objects.filter(pk=self.sell_plans[self.closed].pk).update(
            status='draft',
        )
        response = self.client_as().post(
            '/api/v1/export/local-sell-plans/bulk-submit/',
            {'ids': [self.sell_plans[self.closed].pk]}, format='json',
        )
        self.assert_season_closed_409(response)

    def test_local_sell_initialize_week_in_closed_season_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/local-sell-plans/initialize-week/',
            {'season': self.closed.pk, 'year': 2025, 'week_number': 40},
            format='json',
        )
        self.assert_season_closed_409(response)
        self.assertFalse(
            WeeklyLocalSellPlan.objects.filter(week_number=40, year=2025).exists()
        )

    def test_local_sell_initialize_week_in_active_season_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/local-sell-plans/initialize-week/',
            {'season': self.active.pk, 'year': 2026, 'week_number': 41},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertTrue(
            WeeklyLocalSellPlan.objects.filter(week_number=41, year=2026).exists()
        )

    def test_destination_selection_set_in_closed_season_returns_409(self):
        response = self.client_as().post(
            '/api/v1/export/truck-destination-selections/set/',
            {
                'season': self.closed.pk, 'year': 2025, 'week_number': 42,
                'destination_ids': [self.destination.pk],
            },
            format='json',
        )
        self.assert_season_closed_409(response)
        self.assertFalse(
            WeeklyDestinationSelection.objects.filter(
                week_number=42, year=2025,
            ).exists()
        )

    def test_destination_selection_set_in_active_season_still_works(self):
        response = self.client_as().post(
            '/api/v1/export/truck-destination-selections/set/',
            {
                'season': self.active.pk, 'year': 2026, 'week_number': 43,
                'destination_ids': [self.destination.pk],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertTrue(
            WeeklyDestinationSelection.objects.filter(
                week_number=43, year=2026,
            ).exists()
        )

    def test_harvest_initialize_week_in_closed_season_returns_409(self):
        response = self.client_as().post(
            '/api/v1/greenhouse/harvest-plans/initialize-week/',
            {'season': self.closed.pk, 'year': 2025, 'week_number': 44},
            format='json',
        )
        self.assert_season_closed_409(response)
        self.assertFalse(
            WeeklyHarvestPlan.objects.filter(week_number=44, year=2025).exists()
        )

    def test_harvest_bulk_grant_late_edit_on_closed_season_returns_409(self):
        response = self.client_as().post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            {
                'plan_ids': [self.harvest_plans[self.closed].pk],
                'granted_until': '2099-01-01T00:00:00Z',
            },
            format='json',
        )
        self.assert_season_closed_409(response)
        self.harvest_plans[self.closed].refresh_from_db()
        self.assertIsNone(self.harvest_plans[self.closed].late_edit_granted_until)

    def test_harvest_bulk_grant_late_edit_on_active_season_still_works(self):
        response = self.client_as().post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            {
                'plan_ids': [self.harvest_plans[self.active].pk],
                'granted_until': '2099-01-01T00:00:00Z',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(response.json()['updated'], 1)

    def test_harvest_bulk_revoke_late_edit_on_closed_season_returns_409(self):
        response = self.client_as().post(
            '/api/v1/greenhouse/harvest-plans/bulk-revoke-late-edit/',
            {'plan_ids': [self.harvest_plans[self.closed].pk]}, format='json',
        )
        self.assert_season_closed_409(response)
