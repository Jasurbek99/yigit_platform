from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    ShipmentStatusType,
    Season,
    User,
)
from apps.export.models import (
    Shipment,
    ShipmentBlockSource,
    ShipmentStatusLog,
    SalesReport,
    SalesReportLineItem,
    SalesReportExpense,
)
from apps.export.services import transition_to, TRANSITIONS


def _create_all_statuses():
    """Create state machine v2 status types (12 active + 3 retired)."""
    statuses = [
        ('draft',           0,  'DRAFT',    True),
        ('gumruk_girish',   1,  'CUSTOMS',  True),
        ('gumruk_chykysh',  2,  'CUSTOMS',  True),
        ('yuklenme',        3,  'LOADING',  True),
        ('yola_chykdy',     4,  'TRANSIT',  True),
        ('serhet_gechdi',   5,  'BORDER',   True),
        ('dest_entry',      6,  'BORDER',   True),
        ('barysh_gumrugi',  7,  'BORDER',   True),
        ('transshipment',   8,  'SALES',    True),
        ('bardy',           9,  'SALES',    True),
        ('satylyar',       10,  'SALES',    True),
        ('satyldy',        11,  'SALES',    True),
        ('tamamlandy',     12,  'COMPLETE', True),
        # Retired
        ('serhet_tm',     100,  'BORDER',   False),
        ('yolda',         101,  'TRANSIT',  False),
        ('hasabat',       102,  'COMPLETE', False),
    ]
    for code, order, phase, is_active in statuses:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk':    code,
                'name_en':    code,
                'step_order': order,
                'phase':      phase,
                'is_active':  is_active,
            },
        )


class TransitionServiceTest(TestCase):
    """State machine v2 transition tests.

    Shipment starts at `draft`. Linear chain (no peregruz):
      draft → gumruk_girish → gumruk_chykysh → yuklenme → yola_chykdy →
      serhet_gechdi → dest_entry → barysh_gumrugi → bardy → satylyar →
      satyldy → tamamlandy
    """

    def setUp(self):
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        # export_manager is a privileged role — it can trigger any valid transition.
        # Use it in tests that walk multi-step chains to avoid per-step role setup.
        self.user = User.objects.create_user(
            username='testuser', password='pass', role='export_manager'
        )
        self.document_team_user = User.objects.create_user(
            username='doc_user', password='pass', role='document_team'
        )
        _create_all_statuses()
        self.draft_status = ShipmentStatusType.objects.get(code='draft')
        # The transition_to() draft-leave guard requires both halves of the
        # two-row flow to be present, so a complete draft is created here.
        self.country = Country.objects.create(name_tk='KZ', name_en='KZ', name_ru='KZ', code='KZ')
        self.customer = Customer.objects.create(name='TestCustomer-Trans')
        self.block = GreenhouseBlock.objects.create(code='F-A1', name='Test block A1')
        self.shipment = Shipment.objects.create(
            shipment_code='TEST-001',
            date='2025-11-01',
            season=self.season,
            status=self.draft_status,
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=10000,
        )

    def test_valid_transition(self):
        """A valid sequential transition must update the shipment status."""
        # document_team owns draft → gumruk_girish in v2.
        transition_to(self.shipment, 'gumruk_girish', self.document_team_user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_invalid_transition_raises(self):
        """Skipping steps should raise ValueError."""
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'tamamlandy', self.user)

    def test_invalid_transition_backwards_raises(self):
        """Backwards transitions should raise ValueError."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        with self.assertRaises(ValueError):
            transition_to(self.shipment, 'draft', self.user)

    def test_status_log_created(self):
        """Each transition must append one row to ShipmentStatusLog."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.assertEqual(ShipmentStatusLog.objects.filter(shipment=self.shipment).count(), 1)

    def test_status_log_comment_stored(self):
        """Comment text must be persisted in the status log entry."""
        transition_to(self.shipment, 'gumruk_girish', self.user, comment='Docs checked')
        log_entry = ShipmentStatusLog.objects.get(shipment=self.shipment)
        self.assertEqual(log_entry.comment, 'Docs checked')

    def test_multiple_transitions_produce_multiple_log_entries(self):
        """Two transitions should produce two log entries."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        transition_to(self.shipment, 'gumruk_chykysh', self.user)
        self.assertEqual(ShipmentStatusLog.objects.filter(shipment=self.shipment).count(), 2)

    def test_role_enforcement_raises_permission_error(self):
        """Wrong role on a step must raise PermissionError."""
        # warehouse_chief is not allowed to trigger draft → gumruk_girish (document_team only).
        wh_user = User.objects.create_user(
            username='wh_user_perm', password='pass', role='warehouse_chief'
        )
        with self.assertRaises(PermissionError):
            transition_to(self.shipment, 'gumruk_girish', wh_user)

    def test_privileged_role_bypasses_role_restriction(self):
        """export_manager can trigger any valid transition regardless of per-step role."""
        transition_to(self.shipment, 'gumruk_girish', self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_is_auto_flag_recorded(self):
        """A transition triggered with is_auto=True must mark the log row."""
        transition_to(self.shipment, 'gumruk_girish', self.user, is_auto=True)
        log = ShipmentStatusLog.objects.get(shipment=self.shipment)
        self.assertTrue(log.is_auto)

    def test_is_auto_bypasses_role_check(self):
        """An auto transition must skip the per-step role check."""
        # warehouse_chief is not the canonical role for draft → gumruk_girish,
        # but is_auto=True bypasses the check.
        wh_user = User.objects.create_user(
            username='wh_auto', password='pass', role='warehouse_chief'
        )
        transition_to(self.shipment, 'gumruk_girish', wh_user, is_auto=True)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'gumruk_girish')

    def test_terminal_status_has_no_transitions(self):
        """tamamlandy is terminal — TRANSITIONS dict must return empty list."""
        self.assertEqual(TRANSITIONS['tamamlandy'], [])

    def test_full_lifecycle_no_peregruz(self):
        """Walk all 12 active statuses (no peregruz path) and verify final status."""
        chain = [
            'gumruk_girish', 'gumruk_chykysh', 'yuklenme', 'yola_chykdy',
            'serhet_gechdi', 'dest_entry', 'barysh_gumrugi',
            'bardy', 'satylyar', 'satyldy', 'tamamlandy',
        ]
        for code in chain:
            transition_to(self.shipment, code, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'tamamlandy')
        # 11 transitions from draft.
        self.assertEqual(
            ShipmentStatusLog.objects.filter(shipment=self.shipment).count(),
            len(chain),
        )

    def test_full_lifecycle_with_peregruz(self):
        """has_peregruz=True path: barysh_gumrugi → transshipment → bardy."""
        self.shipment.has_peregruz = True
        self.shipment.save()
        chain = [
            'gumruk_girish', 'gumruk_chykysh', 'yuklenme', 'yola_chykdy',
            'serhet_gechdi', 'dest_entry', 'barysh_gumrugi',
            'transshipment', 'bardy', 'satylyar', 'satyldy', 'tamamlandy',
        ]
        for code in chain:
            transition_to(self.shipment, code, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.status.code, 'tamamlandy')


class SalesReportTest(TestCase):
    """Tests for POST/PATCH /api/v1/export/shipments/{id}/sales-report/."""

    def setUp(self):
        # DynamicResourcePermission reads RoleResourcePermission from the DB,
        # so the seed must run before any role-based API check.
        call_command('seed_permissions')
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30'
        )
        _create_all_statuses()
        # State machine v2: satyldy ("Sold, waiting for Report", step 11) is
        # the status at which sales-report can be submitted. Old hasabat is
        # retired. The "early stage, no report allowed" example uses yuklenme.
        self.satyldy_status = ShipmentStatusType.objects.get(code='satyldy')
        # Kept as alias for backward-compat with test names below.
        self.hasabat_status = self.satyldy_status
        self.loading_status = ShipmentStatusType.objects.get(code='yuklenme')
        self.early_status = ShipmentStatusType.objects.get(code='yuklenme')
        # Kept as alias.
        self.serhet_tm_status = self.early_status

        self.sales_user = User.objects.create_user(
            username='sales_rep_1', password='pass', role='sales_rep'
        )
        self.manager_user = User.objects.create_user(
            username='mgr_1', password='pass', role='export_manager'
        )
        self.wh_user = User.objects.create_user(
            username='wh_1', password='pass', role='warehouse_chief'
        )

        self.shipment_at_hasabat = Shipment.objects.create(
            shipment_code='0101001/25',
            date='2025-01-01',
            season=self.season,
            status=self.satyldy_status,
        )
        self.shipment_at_serhet_tm = Shipment.objects.create(
            shipment_code='0101002/25',
            date='2025-01-02',
            season=self.season,
            status=self.early_status,
        )

        self.client = APIClient()

    def _url(self, shipment_id: int) -> str:
        return f'/api/v1/export/shipments/{shipment_id}/sales-report/'

    def test_sales_report_created_at_hasabat(self):
        """POST sales-report at hasabat must create a SalesReport and return 200."""
        self.client.force_authenticate(user=self.sales_user)
        payload = {
            'price_per_kg': '0.8500',
            'total_usd': '15725.00',
            'weight_sold_kg': '18500.00',
            'weight_rejected_kg': '120.00',
            'transport_cost_usd': '300.00',
            'market_fee_usd': '50.00',
            'other_expenses_usd': '25.00',
            'notes': 'All sold without issues.',
        }
        response = self.client.post(self._url(self.shipment_at_hasabat.id), payload, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        # Verify DB row was created.
        report = SalesReport.objects.get(shipment=self.shipment_at_hasabat)
        self.assertEqual(str(report.price_per_kg), '0.8500')
        self.assertEqual(str(report.weight_sold_kg), '18500.00')
        # Verify response contains nested sales_report.
        self.assertIn('sales_report', response.data)
        self.assertEqual(response.data['sales_report']['price_per_kg'], '0.8500')

    def test_sales_report_patch_updates_existing(self):
        """PATCH sales-report updates an existing report without losing other fields."""
        # Create an initial report.
        report = SalesReport.objects.create(
            shipment=self.shipment_at_hasabat,
            created_by=self.sales_user,
            price_per_kg='0.8000',
            weight_sold_kg='18000.00',
        )
        self.client.force_authenticate(user=self.sales_user)
        response = self.client.patch(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.9000'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        report.refresh_from_db()
        # Price updated.
        self.assertEqual(str(report.price_per_kg), '0.9000')
        # Other field preserved.
        self.assertEqual(str(report.weight_sold_kg), '18000.00')

    def test_sales_report_blocked_before_hasabat(self):
        """POST at an early stage (yuklenme, step 3) must return 400."""
        self.client.force_authenticate(user=self.sales_user)
        response = self.client.post(
            self._url(self.shipment_at_serhet_tm.id),
            {'price_per_kg': '0.85'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        # In v2 the gate is "satyldy or later"; old "hasabat" wording is retired.
        self.assertIn('satyldy', response.data['error'])

    def test_sales_report_wrong_role(self):
        """POST as warehouse_chief must return 403."""
        self.client.force_authenticate(user=self.wh_user)
        response = self.client.post(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.85'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_sales_report_export_manager_allowed(self):
        """export_manager (privileged) must be able to POST a sales report."""
        self.client.force_authenticate(user=self.manager_user)
        response = self.client.post(
            self._url(self.shipment_at_hasabat.id),
            {'price_per_kg': '0.9200', 'total_usd': '17020.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(SalesReport.objects.filter(shipment=self.shipment_at_hasabat).exists())

    # ------------------------------------------------------------------
    # Rich report: nested line_items + expenses
    # ------------------------------------------------------------------

    def _karaganda_payload(self) -> dict:
        """Canonical Karaganda test case from the plan verification section.

        1 line: 18371 kg × 680 KZT → 12,492,280 KZT
        Expenses: NDS 1,476,000 + TOM_ROSHOD 227,250 + ANALIZ 59,745
                  + BAZAR_ROSHOD 103,000 + NAKLIYE 800,000 + INTERES 500,000
                  = 3,165,995 KZT
        Net: 12,492,280 − 3,165,995 = 9,326,285 KZT
        Kurs: 470 KZT/USD → net USD = 9,326,285 / 470 ≈ 19,843.16
        """
        return {
            'currency': 'KZT',
            'exchange_rate': '470.0000',
            'weight_loaded_kg': '18500.00',
            'line_items': [
                {
                    'line_number': 1,
                    'product_name': 'Pomidor',
                    'quantity_kg': '18371.00',
                    'price_local': '680.00',
                    # amount_local omitted — server must compute 18371 × 680
                },
            ],
            'expenses': [
                {'category': 'NDS',          'amount_local': '1476000.00'},
                {'category': 'TOM_ROSHOD',   'amount_local': '227250.00'},
                {'category': 'ANALIZ',       'amount_local': '59745.00'},
                {'category': 'BAZAR_ROSHOD', 'amount_local': '103000.00'},
                {'category': 'NAKLIYE',      'amount_local': '800000.00'},
                {'category': 'INTERES',      'amount_local': '500000.00'},
            ],
        }

    def test_nested_create_persists_children_and_computes_totals(self):
        """PATCH with nested line_items + expenses returns 200, persists children,
        and correctly computes total_sales_local, total_expenses_local, net_income_local."""
        self.client.force_authenticate(user=self.sales_user)
        payload = self._karaganda_payload()

        response = self.client.patch(
            self._url(self.shipment_at_hasabat.id), payload, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)

        report = SalesReport.objects.get(shipment=self.shipment_at_hasabat)

        # --- Line item persisted ---
        self.assertEqual(report.line_items.count(), 1)
        line = report.line_items.first()
        self.assertEqual(str(line.quantity_kg), '18371.00')
        self.assertEqual(str(line.price_local), '680.00')
        # Server must compute amount_local = 18371 × 680 = 12,492,280.00
        self.assertEqual(str(line.amount_local), '12492280.00')

        # --- Expenses persisted ---
        self.assertEqual(report.expenses.count(), 6)

        # --- Computed totals ---
        self.assertEqual(str(report.total_sales_local), '12492280.00')
        self.assertEqual(str(report.total_expenses_local), '3165995.00')
        self.assertEqual(str(report.net_income_local), '9326285.00')

        # --- Response shape includes the new fields ---
        sr = response.data['sales_report']
        self.assertEqual(sr['total_sales_local'], '12492280.00')
        self.assertEqual(sr['total_expenses_local'], '3165995.00')
        self.assertEqual(sr['net_income_local'], '9326285.00')
        self.assertEqual(len(sr['line_items']), 1)
        self.assertEqual(len(sr['expenses']), 6)

    def test_usd_derived_fields_correct_when_exchange_rate_set(self):
        """Derived USD fields equal local / exchange_rate (rounded to 2 dp)."""
        self.client.force_authenticate(user=self.sales_user)
        payload = self._karaganda_payload()

        response = self.client.patch(
            self._url(self.shipment_at_hasabat.id), payload, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)

        sr = response.data['sales_report']
        # net_income_usd = 9,326,285 / 470 = 19,843.1595... → 19843.16
        self.assertIsNotNone(sr['net_income_usd'])
        from decimal import Decimal
        net_usd = Decimal(sr['net_income_usd'])
        expected = (Decimal('9326285.00') / Decimal('470.0000')).quantize(Decimal('0.01'))
        self.assertEqual(net_usd, expected)

        # total_sales_usd = 12,492,280 / 470 = 26,579.31...
        sales_usd = Decimal(sr['total_sales_usd'])
        expected_sales = (Decimal('12492280.00') / Decimal('470.0000')).quantize(Decimal('0.01'))
        self.assertEqual(sales_usd, expected_sales)

        # expenses_usd = 3,165,995 / 470 = 6,736.15...
        exp_usd = Decimal(sr['total_expenses_usd'])
        expected_exp = (Decimal('3165995.00') / Decimal('470.0000')).quantize(Decimal('0.01'))
        self.assertEqual(exp_usd, expected_exp)

    def test_replace_all_removes_old_children(self):
        """A second PATCH with different children replaces the first set completely."""
        self.client.force_authenticate(user=self.sales_user)

        # First PATCH: 2 line items, 2 expenses.
        first_payload = {
            'currency': 'KZT',
            'exchange_rate': '450.0000',
            'line_items': [
                {'line_number': 1, 'quantity_kg': '10000.00', 'price_local': '600.00',
                 'amount_local': '6000000.00'},
                {'line_number': 2, 'quantity_kg': '5000.00', 'price_local': '550.00',
                 'amount_local': '2750000.00'},
            ],
            'expenses': [
                {'category': 'NDS',    'amount_local': '100000.00'},
                {'category': 'ANALIZ', 'amount_local': '50000.00'},
            ],
        }
        r1 = self.client.patch(
            self._url(self.shipment_at_hasabat.id), first_payload, format='json'
        )
        self.assertEqual(r1.status_code, 200, r1.data)

        report = SalesReport.objects.get(shipment=self.shipment_at_hasabat)
        self.assertEqual(report.line_items.count(), 2)
        self.assertEqual(report.expenses.count(), 2)

        # Second PATCH: 1 line item, 1 expense — must replace, not append.
        second_payload = {
            'line_items': [
                {'line_number': 1, 'quantity_kg': '18000.00', 'price_local': '700.00',
                 'amount_local': '12600000.00'},
            ],
            'expenses': [
                {'category': 'NAKLIYE', 'amount_local': '900000.00'},
            ],
        }
        r2 = self.client.patch(
            self._url(self.shipment_at_hasabat.id), second_payload, format='json'
        )
        self.assertEqual(r2.status_code, 200, r2.data)

        report.refresh_from_db()
        self.assertEqual(report.line_items.count(), 1)
        self.assertEqual(report.expenses.count(), 1)
        # Old NDS expense must be gone.
        self.assertFalse(
            report.expenses.filter(category='NDS').exists()
        )
        # Total recomputed from new children.
        self.assertEqual(str(report.total_sales_local), '12600000.00')
        self.assertEqual(str(report.total_expenses_local), '900000.00')
        self.assertEqual(str(report.net_income_local), '11700000.00')
