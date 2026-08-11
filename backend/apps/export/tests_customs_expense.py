"""Tests for the customs/document cash-advance ledger (money-OUT side).

Covers:
- Create per-shipment expense (write-allowed role)
- Create batch expense (shipment=null, quantity set)
- Role-gating 403 for non-write role (seller)
- Ledger aggregation: advances_total, expenses_total, balance, by_category
- amount <= 0 validation
- customs_expenses nested array on shipment detail response

Run specifically:
    python manage.py test apps.export.tests_customs_expense
"""
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country,
    Customer,
    GreenhouseBlock,
    RoleResourcePermission,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import (
    CustomsExpense,
    CustomsExpenseCategory,
    FinansistAdvance,
    FinansistAdvanceShipment,
    Shipment,
    ShipmentBlockSource,
)


def _create_all_statuses():
    """Create minimal status set (only draft needed for shipment creation)."""
    statuses = [
        ('draft', 0, 'DRAFT', True),
    ]
    for code, order, phase, is_active in statuses:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code,
                'name_en': code,
                'step_order': order,
                'phase': phase,
                'is_active': is_active,
            },
        )


class CustomsExpenseSetUpMixin(TestCase):
    """Shared fixtures for all customs expense tests.

    Creates: season, country, customer, block, a draft shipment,
    and two users — one with write access (export_manager), one without (seller).
    """

    def setUp(self):
        _create_all_statuses()
        # is_active=True: CustomsExpenseViewSet.get_queryset() now fails closed
        # (Task 6 season scoping) when resolve_season() finds no active season.
        self.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        self.country = Country.objects.create(
            name_tk='TM', name_en='Turkmenistan', name_ru='TM', code='TM'
        )
        self.customer = Customer.objects.create(name='TestBuyer')
        self.block = GreenhouseBlock.objects.create(code='A', name='Block A')
        self.draft_status = ShipmentStatusType.objects.get(code='draft')

        self.writer = User.objects.create_user(
            username='mgr_customs', password='pass', role='export_manager'
        )
        self.reader = User.objects.create_user(
            username='seller_customs', password='pass', role='seller'
        )

        self.shipment = Shipment.objects.create(
            shipment_code='TEST-CE-001',
            date='2026-06-01',
            season=self.season,
            status=self.draft_status,
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )
        ShipmentBlockSource.objects.create(
            shipment=self.shipment, block=self.block, weight_kg=10000
        )

        self.client = APIClient()

    def _login(self, user: User) -> None:
        self.client.force_authenticate(user=user)

    def _list_url(self) -> str:
        return reverse('customs-expense-list')

    def _detail_url(self, pk: int) -> str:
        return reverse('customs-expense-detail', kwargs={'pk': pk})

    def _ledger_url(self) -> str:
        return reverse('customs-expense-ledger')

    def _shipment_detail_url(self) -> str:
        return reverse('shipment-detail', kwargs={'pk': self.shipment.pk})


class TestCustomsExpenseCreate(CustomsExpenseSetUpMixin):
    """Test create path — per-shipment and batch fees."""

    def test_create_per_shipment_expense(self):
        """A write-allowed user can create an expense linked to a shipment."""
        self._login(self.writer)
        payload = {
            'expense_date': '2026-06-15',
            'category': CustomsExpenseCategory.GUMRUKLEME,
            'amount': '450.00',
            'currency': 'TMT',
            'shipment': self.shipment.pk,
            'export_code_raw': 'TEST-CE-001',
            'vehicle_plate': '48 AT 580',
            'route_label': 'HMS-DM',
            'label_raw': 'Gumrukleme haky',
        }
        response = self.client.post(self._list_url(), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        data = response.data
        self.assertEqual(data['category'], 'GUMRUKLEME')
        self.assertEqual(data['category_display'], 'Customs clearance (per truck)')
        self.assertEqual(Decimal(data['amount']), Decimal('450.00'))
        self.assertEqual(data['shipment'], self.shipment.pk)
        self.assertEqual(data['shipment_code'], 'TEST-CE-001')
        self.assertEqual(data['created_by_name'], 'mgr_customs')
        self.assertIsNotNone(data['created_at'])

        # Confirm DB row created
        self.assertEqual(CustomsExpense.objects.count(), 1)

    def test_create_batch_expense_no_shipment(self):
        """Batch fee with shipment=null and quantity set is allowed."""
        self._login(self.writer)
        payload = {
            'expense_date': '2026-06-15',
            'category': CustomsExpenseCategory.KARANTIN,
            'amount': '1900.00',
            'currency': 'TMT',
            'shipment': None,
            'quantity': 19,
            'label_raw': '19 AD KARANTIN',
        }
        response = self.client.post(self._list_url(), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        data = response.data
        self.assertIsNone(data['shipment'])
        self.assertIsNone(data['shipment_code'])
        self.assertEqual(data['quantity'], 19)
        self.assertEqual(Decimal(data['amount']), Decimal('1900.00'))


class TestCustomsExpensePermissions(CustomsExpenseSetUpMixin):
    """Test role-gating on write operations."""

    def test_create_blocked_for_non_write_role(self):
        """A seller cannot create expenses — 403 expected."""
        self._login(self.reader)
        payload = {
            'expense_date': '2026-06-15',
            'category': CustomsExpenseCategory.GUMRUKLEME,
            'amount': '100.00',
            'currency': 'TMT',
        }
        response = self.client.post(self._list_url(), payload, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertIn('error', response.data)

    def test_patch_blocked_for_non_write_role(self):
        """A seller cannot update expenses — 403 expected."""
        expense = CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.FITO,
            amount=Decimal('200.00'),
            currency='TMT',
            created_by=self.writer,
        )
        self._login(self.reader)
        response = self.client.patch(
            self._detail_url(expense.pk), {'amount': '999.00'}, format='json'
        )
        self.assertEqual(response.status_code, 403)

    def test_delete_blocked_for_non_write_role(self):
        """A seller cannot delete expenses — 403 expected."""
        expense = CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.CT1,
            amount=Decimal('150.00'),
            currency='TMT',
            created_by=self.writer,
        )
        self._login(self.reader)
        response = self.client.delete(self._detail_url(expense.pk))
        self.assertEqual(response.status_code, 403)

    def test_list_allowed_for_any_authenticated_user(self):
        """Reads are open to any authenticated user."""
        self._login(self.reader)
        response = self.client.get(self._list_url())
        self.assertEqual(response.status_code, 200)


class TestCustomsExpenseFilter(CustomsExpenseSetUpMixin):
    """Test filterset_fields — ?category= and ?currency= must narrow results."""

    def setUp(self):
        super().setUp()
        # Create two expenses with different categories
        CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.GUMRUKLEME,
            amount=Decimal('450.00'),
            currency='TMT',
            created_by=self.writer,
        )
        CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.FITO,
            amount=Decimal('120.00'),
            currency='TMT',
            created_by=self.writer,
        )

    def test_category_filter_narrows_results(self):
        """?category=GUMRUKLEME returns only GUMRUKLEME rows."""
        self._login(self.writer)
        response = self.client.get(self._list_url(), {'category': 'GUMRUKLEME'})
        self.assertEqual(response.status_code, 200)
        results = response.data.get('results', response.data)
        # All returned rows must be GUMRUKLEME
        for row in results:
            self.assertEqual(row['category'], 'GUMRUKLEME')
        # Must be fewer than the total count (FITO should not appear)
        all_response = self.client.get(self._list_url())
        all_count = len(all_response.data.get('results', all_response.data))
        self.assertLess(len(results), all_count)

    def test_patch_allowed_for_write_role(self):
        """A write-allowed role can PATCH an expense and receive 200."""
        expense = CustomsExpense.objects.get(category=CustomsExpenseCategory.GUMRUKLEME)
        self._login(self.writer)
        response = self.client.patch(
            self._detail_url(expense.pk),
            {'amount': '500.00', 'label_raw': 'Updated note'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Decimal(response.data['amount']), Decimal('500.00'))
        self.assertEqual(response.data['label_raw'], 'Updated note')


class TestCustomsExpenseValidation(CustomsExpenseSetUpMixin):
    """Test field-level validation."""

    def test_amount_zero_rejected(self):
        """amount=0 must return 400."""
        self._login(self.writer)
        payload = {
            'expense_date': '2026-06-15',
            'category': CustomsExpenseCategory.ANALIZ,
            'amount': '0.00',
            'currency': 'TMT',
        }
        response = self.client.post(self._list_url(), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('amount', response.data)

    def test_amount_negative_rejected(self):
        """amount=-5 must return 400."""
        self._login(self.writer)
        payload = {
            'expense_date': '2026-06-15',
            'category': CustomsExpenseCategory.ANALIZ,
            'amount': '-5.00',
            'currency': 'TMT',
        }
        response = self.client.post(self._list_url(), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('amount', response.data)


class TestCustomsExpenseLedger(CustomsExpenseSetUpMixin):
    """Test /ledger/ aggregation endpoint."""

    def setUp(self):
        super().setUp()
        # A second, closed, season + a shipment inside it — for the
        # season-scoping cases below. Kept out of CustomsExpenseSetUpMixin
        # since the other test classes in this file don't need it.
        self.closed_season = Season.objects.create(
            name='2024-2025', start_date='2024-09-01', end_date='2025-06-30',
            closed_at=timezone.now(),
        )
        self.closed_shipment = Shipment.objects.create(
            shipment_code='TEST-CE-CLS',
            date='2025-06-01',
            season=self.closed_season,
            status=self.draft_status,
            country=self.country,
            customer=self.customer,
            has_peregruz=False,
        )

    def _create_advance(
        self, amount: str, advance_date: str = '2026-06-10', shipment=None,
    ) -> FinansistAdvance:
        advance = FinansistAdvance.objects.create(
            advance_date=advance_date,
            total_amount=Decimal(amount),
            # Manat: the ledger scopes both sides to one currency (default TMT),
            # so advances must match the customs-expense currency to be counted.
            currency='TMT',
            issued_by=self.writer,
        )
        if shipment is not None:
            FinansistAdvanceShipment.objects.create(advance=advance, shipment=shipment)
        return advance

    def _create_expense(
        self, amount: str, category: str, expense_date: str = '2026-06-15', shipment=None,
    ) -> CustomsExpense:
        return CustomsExpense.objects.create(
            expense_date=expense_date,
            category=category,
            amount=Decimal(amount),
            currency='TMT',
            created_by=self.writer,
            shipment=shipment,
        )

    def test_ledger_totals_and_balance(self):
        """advances_total and expenses_total aggregate correctly, balance derived."""
        self._create_advance('5000.00')
        self._create_advance('3000.00')
        self._create_expense('2000.00', CustomsExpenseCategory.GUMRUKLEME)
        self._create_expense('1500.00', CustomsExpenseCategory.KARANTIN)

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200, response.data)

        data = response.data
        self.assertEqual(data['currency'], 'TMT')
        self.assertEqual(Decimal(data['advances_total']), Decimal('8000.00'))
        self.assertEqual(Decimal(data['expenses_total']), Decimal('3500.00'))
        self.assertEqual(Decimal(data['balance']), Decimal('4500.00'))

    def test_ledger_by_category_ordering(self):
        """by_category is ordered by total descending."""
        self._create_expense('3000.00', CustomsExpenseCategory.GUMRUKLEME)
        self._create_expense('1000.00', CustomsExpenseCategory.KARANTIN)
        self._create_expense('500.00', CustomsExpenseCategory.FITO)

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200)

        cats = [row['category'] for row in response.data['by_category']]
        totals = [Decimal(row['total']) for row in response.data['by_category']]

        self.assertEqual(cats[0], 'GUMRUKLEME')
        self.assertEqual(cats[1], 'KARANTIN')
        self.assertEqual(cats[2], 'FITO')
        # Verify totals descend
        self.assertGreater(totals[0], totals[1])
        self.assertGreater(totals[1], totals[2])

    def test_ledger_by_category_has_display_name(self):
        """category_display is the human-readable label, not the code."""
        self._create_expense('100.00', CustomsExpenseCategory.CT1)

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        row = next(
            r for r in response.data['by_category'] if r['category'] == 'CT1'
        )
        self.assertEqual(row['category_display'], 'CT-1 certificate of origin')

    def test_ledger_empty_window_returns_zero(self):
        """Empty date window returns all zeros and empty lists."""
        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Decimal(response.data['advances_total']), Decimal('0'))
        self.assertEqual(Decimal(response.data['expenses_total']), Decimal('0'))
        self.assertEqual(Decimal(response.data['balance']), Decimal('0'))
        self.assertEqual(response.data['by_category'], [])
        self.assertEqual(response.data['by_date'], [])

    def test_ledger_date_filter(self):
        """date_from / date_to constrain both advances and expenses."""
        self._create_expense('1000.00', CustomsExpenseCategory.GUMRUKLEME, '2026-06-01')
        self._create_expense('500.00', CustomsExpenseCategory.GUMRUKLEME, '2026-06-20')

        self._login(self.writer)
        response = self.client.get(
            self._ledger_url(), {'date_from': '2026-06-15', 'date_to': '2026-06-30'}
        )
        self.assertEqual(response.status_code, 200)
        # Only the 2026-06-20 expense should be included.
        self.assertEqual(Decimal(response.data['expenses_total']), Decimal('500.00'))

    def test_ledger_by_date_includes_both_sides(self):
        """by_date merges advance and expense dates into a unified ascending list."""
        self._create_advance('2000.00', advance_date='2026-06-05')
        self._create_expense('800.00', CustomsExpenseCategory.GUMRUKLEME, '2026-06-10')

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        by_date = response.data['by_date']

        dates = [row['date'] for row in by_date]
        self.assertIn('2026-06-05', dates)
        self.assertIn('2026-06-10', dates)
        # Dates must be in ascending order
        self.assertEqual(dates, sorted(dates))

        # Verify the advance-only day shows 0 expenses
        advance_day = next(r for r in by_date if r['date'] == '2026-06-05')
        self.assertEqual(Decimal(advance_day['advances']), Decimal('2000.00'))
        self.assertEqual(Decimal(advance_day['expenses']), Decimal('0'))

    def test_ledger_invalid_date_returns_400(self):
        """Malformed date_from returns 400 with error message."""
        self._login(self.writer)
        response = self.client.get(self._ledger_url(), {'date_from': 'not-a-date'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)

    def test_ledger_scopes_to_single_currency(self):
        """Advances in a different currency are excluded — no USD/TMT mixing."""
        self._create_advance('5000.00')  # TMT
        FinansistAdvance.objects.create(
            advance_date='2026-06-10',
            total_amount=Decimal('9999.00'),
            currency='USD',  # must NOT leak into the default TMT ledger
            issued_by=self.writer,
        )
        self._create_expense('2000.00', CustomsExpenseCategory.GUMRUKLEME)

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['currency'], 'TMT')
        self.assertEqual(Decimal(response.data['advances_total']), Decimal('5000.00'))
        self.assertEqual(Decimal(response.data['balance']), Decimal('3000.00'))

        # Explicit ?currency=USD surfaces only the USD advance, no expenses.
        usd = self.client.get(self._ledger_url(), {'currency': 'USD'})
        self.assertEqual(Decimal(usd.data['advances_total']), Decimal('9999.00'))
        self.assertEqual(Decimal(usd.data['expenses_total']), Decimal('0'))

    def test_ledger_excludes_closed_season_money(self):
        """Closed-season expenses/advances must not leak into the default
        (active-season) ledger — balance, by_category, and by_date must all
        agree.
        """
        self._create_expense(
            '999.00', CustomsExpenseCategory.GUMRUKLEME, expense_date='2025-01-10',
            shipment=self.closed_shipment,
        )
        self._create_advance('888.00', advance_date='2025-01-10', shipment=self.closed_shipment)
        # Active-season money — must still show up.
        self._create_expense('100.00', CustomsExpenseCategory.FITO)
        self._create_advance('50.00')

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200, response.data)

        self.assertEqual(Decimal(response.data['expenses_total']), Decimal('100.00'))
        self.assertEqual(Decimal(response.data['advances_total']), Decimal('50.00'))
        self.assertEqual(Decimal(response.data['balance']), Decimal('-50.00'))

        categories = {row['category'] for row in response.data['by_category']}
        self.assertNotIn('GUMRUKLEME', categories)
        self.assertIn('FITO', categories)

        dates = {row['date'] for row in response.data['by_date']}
        self.assertNotIn('2025-01-10', dates)

    def test_ledger_denied_without_permission_for_closed_season(self):
        """?season=<closed> without closed_season.can_view must 403, not
        silently return an empty (or worse, unscoped) ledger.
        """
        self._create_expense(
            '50.00', CustomsExpenseCategory.FITO, expense_date='2025-01-10',
            shipment=self.closed_shipment,
        )
        self._login(self.writer)
        response = self.client.get(self._ledger_url(), {'season': self.closed_season.pk})
        self.assertEqual(response.status_code, 403)

    def test_ledger_visible_with_permission_for_closed_season(self):
        """With the grant, ?season=<closed> surfaces that season's money —
        proving the exclusion above is season-scoping, not a permanent hole.
        """
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season', defaults={'can_view': True},
        )
        self._create_expense(
            '50.00', CustomsExpenseCategory.FITO, expense_date='2025-01-10',
            shipment=self.closed_shipment,
        )
        self._create_advance('75.00', advance_date='2025-01-10', shipment=self.closed_shipment)
        # Active-season money must NOT leak into the closed-season view either.
        self._create_expense('999.00', CustomsExpenseCategory.GUMRUKLEME)

        self._login(self.writer)
        response = self.client.get(self._ledger_url(), {'season': self.closed_season.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Decimal(response.data['expenses_total']), Decimal('50.00'))
        self.assertEqual(Decimal(response.data['advances_total']), Decimal('75.00'))

    def test_ledger_no_active_season_returns_all_zero(self):
        """D7 on the ledger too: during the close→open gap, the ledger must
        fail closed (all zeros / empty breakdowns) rather than mixing every
        season's cash together.
        """
        Season.objects.filter(pk=self.season.pk).update(is_active=False)
        self._create_expense('50.00', CustomsExpenseCategory.FITO)
        self._create_advance('75.00')

        self._login(self.writer)
        response = self.client.get(self._ledger_url())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['advances_total'], '0')
        self.assertEqual(response.data['expenses_total'], '0')
        self.assertEqual(response.data['balance'], '0')
        self.assertEqual(response.data['by_category'], [])
        self.assertEqual(response.data['by_date'], [])


class TestCustomsExpenseOnShipmentDetail(CustomsExpenseSetUpMixin):
    """Test that customs_expenses appear nested in the shipment detail response.

    ShipmentViewSet uses DynamicResourcePermission which reads RoleResourcePermission
    rows from the DB.  seed_permissions must run before any shipment API call.
    """

    def setUp(self):
        super().setUp()
        # Seed role/resource permission rows so DynamicResourcePermission lets
        # export_manager access shipment endpoints.
        call_command('seed_permissions', verbosity=0)

    def test_customs_expenses_nested_on_shipment_detail(self):
        """customs_expenses[] is included in shipment detail and contains created rows."""
        CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.GUMRUKLEME,
            amount=Decimal('450.00'),
            currency='TMT',
            shipment=self.shipment,
            created_by=self.writer,
        )
        CustomsExpense.objects.create(
            expense_date='2026-06-15',
            category=CustomsExpenseCategory.FITO,
            amount=Decimal('120.00'),
            currency='TMT',
            shipment=self.shipment,
            created_by=self.writer,
        )

        self._login(self.writer)
        response = self.client.get(self._shipment_detail_url())
        self.assertEqual(response.status_code, 200, response.data)

        data = response.data
        self.assertIn('customs_expenses', data)
        self.assertEqual(len(data['customs_expenses']), 2)

        categories_returned = {row['category'] for row in data['customs_expenses']}
        self.assertIn('GUMRUKLEME', categories_returned)
        self.assertIn('FITO', categories_returned)

    def test_shipment_with_no_expenses_returns_empty_array(self):
        """Shipment with no customs_expenses returns [] not null."""
        self._login(self.writer)
        response = self.client.get(self._shipment_detail_url())
        self.assertEqual(response.status_code, 200)
        self.assertIn('customs_expenses', response.data)
        self.assertEqual(response.data['customs_expenses'], [])
