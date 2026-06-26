"""Tests for the customer-based Sales Rep ownership model + endpoints + worklist action.

Run with:
    python manage.py test apps.export.tests_sales_rep --verbosity=2

Buckets:
  1. coverage PUT replace-all (add, then change the set; reassign-away case)
  2. coverage GET lists all reps incl. reps with no assigned customers
  3. worklist filters by customer ownership only
  4. needs_report=true excludes shipments that already have a SalesReport
  5. management role (export_manager) sees all step-4+ regardless of ownership
  6. sales_rep with no assigned customers sees none
  7. coverage PUT 403 for a non-privileged role (sales_rep)
  8. coverage PUT 400 when target user is not a sales_rep
  9. PATCH /core/customers/{id}/ rejects sales_rep set to a non-sales_rep user
"""

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, Customer, Season, ShipmentStatusType, User
from apps.export.models import SalesReport, Shipment


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str = 'export_manager') -> User:
    """Create and persist a test user with the given role."""
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_country(code: str) -> Country:
    """Get-or-create a Country by code."""
    country, _ = Country.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_ru': code,
            'name_en': code,
        },
    )
    return country


def _make_customer(name: str, sales_rep: User | None = None) -> Customer:
    """Create a Customer, optionally assigned to a sales rep."""
    return Customer.objects.create(name=name, sales_rep=sales_rep)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='sr25',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


def _make_status(code: str, step_order: int, phase: str = 'TRANSIT') -> ShipmentStatusType:
    """Get-or-create a ShipmentStatusType row."""
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': phase,
        },
    )
    return st


def _make_shipment(
    code: str,
    country: Country,
    status: ShipmentStatusType,
    customer: Customer | None = None,
    creator: User | None = None,
    season: Season | None = None,
) -> Shipment:
    """Create a Shipment with the given country, status, and optional customer."""
    if season is None:
        season = _make_season()
    return Shipment.objects.create(
        shipment_code=code,
        date='2026-01-10',
        season=season,
        country=country,
        customer=customer,
        status=status,
        created_by=creator,
    )


# ---------------------------------------------------------------------------
# Test: coverage PUT replace-all (add, change, reassign-away)
# ---------------------------------------------------------------------------

class TestCoveragePutReplaceAll(TestCase):
    """PUT /api/v1/export/sales-rep-coverage/{user_id}/ replaces all assignments."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.manager = _make_user('mgr_put', 'export_manager')
        cls.rep = _make_user('rep_put', 'sales_rep')
        cls.rep2 = _make_user('rep_put2', 'sales_rep')
        cls.cust_a = _make_customer('CustA_put')
        cls.cust_b = _make_customer('CustB_put')
        cls.cust_c = _make_customer('CustC_put')

    def setUp(self):
        cache.clear()
        # Reset assignments to ensure test isolation.
        Customer.objects.filter(
            id__in=[self.cust_a.id, self.cust_b.id, self.cust_c.id]
        ).update(sales_rep=None)
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)
        self.url = f'/api/v1/export/sales-rep-coverage/{self.rep.id}/'

    def test_put_creates_assignments(self):
        """Initial PUT assigns customers to the rep."""
        resp = self.client.put(
            self.url, {'customer_ids': [self.cust_a.id, self.cust_b.id]}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertCountEqual(resp.data['customer_ids'], [self.cust_a.id, self.cust_b.id])
        self.assertEqual(
            Customer.objects.filter(sales_rep=self.rep).count(), 2
        )

    def test_put_replaces_existing_assignments(self):
        """Second PUT with different IDs replaces the first set entirely."""
        # First assignment: A + B
        self.client.put(
            self.url, {'customer_ids': [self.cust_a.id, self.cust_b.id]}, format='json'
        )
        self.assertEqual(Customer.objects.filter(sales_rep=self.rep).count(), 2)

        # Replace with just C
        resp = self.client.put(
            self.url, {'customer_ids': [self.cust_c.id]}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['customer_ids'], [self.cust_c.id])
        self.assertEqual(Customer.objects.filter(sales_rep=self.rep).count(), 1)
        # A and B were cleared
        self.assertIsNone(Customer.objects.get(id=self.cust_a.id).sales_rep)
        self.assertIsNone(Customer.objects.get(id=self.cust_b.id).sales_rep)

    def test_put_empty_customer_ids_clears_assignments(self):
        """PUT with empty list removes all assignments for the rep."""
        Customer.objects.filter(id=self.cust_a.id).update(sales_rep=self.rep)
        resp = self.client.put(self.url, {'customer_ids': []}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['customer_ids'], [])
        self.assertFalse(Customer.objects.filter(sales_rep=self.rep).exists())

    def test_put_with_invalid_customer_id_returns_400(self):
        """A customer ID that doesn't exist in the DB → 400."""
        resp = self.client.put(self.url, {'customer_ids': [999999]}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_put_reassigns_customer_from_another_rep(self):
        """Assigning a customer already owned by rep2 moves it to rep (one-rep-per-customer)."""
        Customer.objects.filter(id=self.cust_a.id).update(sales_rep=self.rep2)
        self.assertEqual(Customer.objects.get(id=self.cust_a.id).sales_rep, self.rep2)

        # Now assign cust_a to rep
        resp = self.client.put(
            self.url, {'customer_ids': [self.cust_a.id]}, format='json'
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        # Customer moved to rep; rep2 no longer owns it
        self.assertEqual(Customer.objects.get(id=self.cust_a.id).sales_rep, self.rep)
        self.assertFalse(Customer.objects.filter(sales_rep=self.rep2).exists())


# ---------------------------------------------------------------------------
# Test: coverage GET lists ALL reps including those with no customers
# ---------------------------------------------------------------------------

class TestCoverageGet(TestCase):
    """GET /api/v1/export/sales-rep-coverage/ includes reps with zero assignments."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.manager = _make_user('mgr_get', 'export_manager')
        cls.rep_assigned = _make_user('rep_assigned', 'sales_rep')
        cls.rep_empty = _make_user('rep_empty_get', 'sales_rep')
        cls.cust = _make_customer('CustGet', sales_rep=cls.rep_assigned)

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_returns_all_reps(self):
        """Both assigned and unassigned reps appear in the response."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get('/api/v1/export/sales-rep-coverage/')
        self.assertEqual(resp.status_code, 200, resp.content)
        rep_ids = [row['sales_rep'] for row in resp.data]
        self.assertIn(self.rep_assigned.id, rep_ids)
        self.assertIn(self.rep_empty.id, rep_ids)

    def test_unassigned_rep_has_empty_customer_ids(self):
        """Rep with no assigned customers → customer_ids = []."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get('/api/v1/export/sales-rep-coverage/')
        self.assertEqual(resp.status_code, 200)
        empty_row = next(
            (row for row in resp.data if row['sales_rep'] == self.rep_empty.id), None
        )
        self.assertIsNotNone(empty_row)
        self.assertEqual(empty_row['customer_ids'], [])

    def test_assigned_rep_row_contains_customer_id(self):
        """Rep with assigned customer → customer_ids contains the customer ID."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get('/api/v1/export/sales-rep-coverage/')
        assigned_row = next(
            (row for row in resp.data if row['sales_rep'] == self.rep_assigned.id), None
        )
        self.assertIsNotNone(assigned_row)
        self.assertIn(self.cust.id, assigned_row['customer_ids'])


# ---------------------------------------------------------------------------
# Test: worklist filters by customer ownership
# ---------------------------------------------------------------------------

class TestMySalesReportsWorklist(TestCase):
    """GET /api/v1/export/shipments/my-sales-reports/ customer-ownership scoping."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = _make_user('rep_wl', 'sales_rep')
        cls.season = _make_season()
        cls.status_4 = _make_status('yola_chykdy', step_order=4, phase='TRANSIT')
        cls.kz = _make_country('KZX')
        # Customer assigned to this rep
        cls.owned_cust = _make_customer('OwnedCust', sales_rep=cls.rep)
        # Customer belonging to nobody
        cls.other_cust = _make_customer('OtherCust', sales_rep=None)
        # Shipment whose customer is owned by rep (should appear)
        cls.ship_owned = _make_shipment(
            '0101010/25', cls.kz, cls.status_4,
            customer=cls.owned_cust, creator=cls.rep, season=cls.season,
        )
        # Shipment with a different customer (should NOT appear)
        cls.ship_other = _make_shipment(
            '0101011/25', cls.kz, cls.status_4,
            customer=cls.other_cust, creator=cls.rep, season=cls.season,
        )
        # Shipment with no customer (should NOT appear for rep)
        cls.ship_null_cust = _make_shipment(
            '0101013/25', cls.kz, cls.status_4,
            customer=None, creator=cls.rep, season=cls.season,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.rep)

    def test_worklist_shows_owned_customer_shipment(self):
        """Shipment with an owned customer appears in the rep's worklist."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertIn(self.ship_owned.id, ids)

    def test_worklist_hides_unowned_customer_shipment(self):
        """Shipment with another rep's (or nobody's) customer does not appear."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertNotIn(self.ship_other.id, ids)

    def test_worklist_hides_null_customer_shipment(self):
        """Shipment with no customer (customer=NULL) does not appear for reps."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertNotIn(self.ship_null_cust.id, ids)

    def test_worklist_excludes_step_below_4(self):
        """A step-1 shipment with an owned customer is not included."""
        status_1 = _make_status('draft_wl', step_order=1, phase='PREP')
        ship_early = _make_shipment(
            '0101012/25', self.kz, status_1,
            customer=self.owned_cust, season=self.season,
        )
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertNotIn(ship_early.id, ids)


# ---------------------------------------------------------------------------
# Test: needs_report filter
# ---------------------------------------------------------------------------

class TestNeedsReportFilter(TestCase):
    """needs_report=true hides shipments that already have a SalesReport."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = _make_user('rep_nr', 'sales_rep')
        cls.season = _make_season()
        cls.status_4 = _make_status('yola_chykdy2', step_order=4, phase='TRANSIT')
        cls.kz = _make_country('KZY')
        cls.cust = _make_customer('CustNR', sales_rep=cls.rep)
        # Shipment WITH a SalesReport (reported)
        cls.reported = _make_shipment(
            '0202001/25', cls.kz, cls.status_4, customer=cls.cust, season=cls.season
        )
        SalesReport.objects.create(shipment=cls.reported, created_by=cls.rep)
        # Shipment WITHOUT a SalesReport (unreported)
        cls.unreported = _make_shipment(
            '0202002/25', cls.kz, cls.status_4, customer=cls.cust, season=cls.season
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.rep)

    def test_needs_report_true_excludes_reported(self):
        """?needs_report=true must NOT include the shipment that has a report."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/?needs_report=true')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertNotIn(self.reported.id, ids)
        self.assertIn(self.unreported.id, ids)

    def test_needs_report_true_includes_has_sales_report_field(self):
        """The serializer must expose has_sales_report=False for the unreported row."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/?needs_report=true')
        self.assertEqual(resp.status_code, 200)
        unreported_row = next(
            (s for s in resp.data['results'] if s['id'] == self.unreported.id), None
        )
        self.assertIsNotNone(unreported_row)
        self.assertFalse(unreported_row['has_sales_report'])

    def test_no_filter_returns_both(self):
        """Without needs_report param, both reported and unreported appear."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertIn(self.reported.id, ids)
        self.assertIn(self.unreported.id, ids)


# ---------------------------------------------------------------------------
# Test: management role sees all step-4+ regardless of customer ownership
# ---------------------------------------------------------------------------

class TestManagementSeesAll(TestCase):
    """export_manager / director / superuser see all step-4+ (no customer filter)."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.manager = _make_user('mgr_all', 'export_manager')
        cls.season = _make_season()
        cls.status_4 = _make_status('yola_chykdy3', step_order=4, phase='TRANSIT')
        cls.kz = _make_country('KZA')
        cls.ru = _make_country('RUA')
        # Shipment with no customer at all
        cls.ship_no_cust = _make_shipment(
            '0303001/25', cls.kz, cls.status_4, customer=None, season=cls.season
        )
        # Shipment with a customer assigned to a different rep
        other_rep = _make_user('other_rep_all', 'sales_rep')
        cust_ru = _make_customer('CustAllRU', sales_rep=other_rep)
        cls.ship_cust_ru = _make_shipment(
            '0303002/25', cls.ru, cls.status_4, customer=cust_ru, season=cls.season
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_export_manager_sees_all(self):
        """export_manager sees all step-4+ regardless of customer ownership."""
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertIn(self.ship_no_cust.id, ids)
        self.assertIn(self.ship_cust_ru.id, ids)

    def test_superuser_sees_all(self):
        """Superuser sees all step-4+ shipments regardless of customer ownership."""
        superuser = _make_user('su_all', 'admin')
        superuser.is_superuser = True
        superuser.save()
        self.client.force_authenticate(user=superuser)
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [s['id'] for s in resp.data['results']]
        self.assertIn(self.ship_no_cust.id, ids)
        self.assertIn(self.ship_cust_ru.id, ids)


# ---------------------------------------------------------------------------
# Test: sales_rep with no assigned customers sees none
# ---------------------------------------------------------------------------

class TestNoCoverageEmptyList(TestCase):
    """A sales_rep with no assigned customers gets an empty worklist."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = _make_user('rep_nocov', 'sales_rep')
        cls.season = _make_season()
        cls.status_4 = _make_status('yola_chykdy4', step_order=4, phase='TRANSIT')
        cls.kz = _make_country('KZB')
        # Shipment with a customer NOT owned by this rep
        other_rep = _make_user('other_rep_nc', 'sales_rep')
        cust = _make_customer('CustNoCov', sales_rep=other_rep)
        _make_shipment('0404001/25', cls.kz, cls.status_4, customer=cust, season=cls.season)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.rep)

    def test_no_assigned_customers_returns_empty_results(self):
        """Rep with zero assigned customers sees an empty list."""
        resp = self.client.get('/api/v1/export/shipments/my-sales-reports/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['count'], 0)
        self.assertEqual(resp.data['results'], [])


# ---------------------------------------------------------------------------
# Test: coverage PUT 403 for non-privileged role
# ---------------------------------------------------------------------------

class TestCoverageGate403(TestCase):
    """Non-privileged users (sales_rep, transport, …) cannot manage coverage."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.rep = _make_user('rep_gate', 'sales_rep')
        cls.target_rep = _make_user('rep_target_g', 'sales_rep')
        cls.cust = _make_customer('CustGate')

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_sales_rep_cannot_put_coverage(self):
        """A sales_rep POSTing coverage for another rep → 403."""
        self.client.force_authenticate(user=self.rep)
        resp = self.client.put(
            f'/api/v1/export/sales-rep-coverage/{self.target_rep.id}/',
            {'customer_ids': [self.cust.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_sales_rep_cannot_get_coverage_list(self):
        """A sales_rep reading the coverage list → 403."""
        self.client.force_authenticate(user=self.rep)
        resp = self.client.get('/api/v1/export/sales-rep-coverage/')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_anonymous_gets_401(self):
        """Unauthenticated request → 401."""
        resp = self.client.get('/api/v1/export/sales-rep-coverage/')
        self.assertEqual(resp.status_code, 401, resp.content)


# ---------------------------------------------------------------------------
# Test: coverage PUT 400 when target user is not a sales_rep
# ---------------------------------------------------------------------------

class TestCoveragePut400NotSalesRep(TestCase):
    """PUT targeting a user who is not role='sales_rep' → 400."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        cls.manager = _make_user('mgr_400', 'export_manager')
        cls.doc_user = _make_user('doc_400', 'document_team')
        cls.cust = _make_customer('Cust400')

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def test_put_non_sales_rep_user_returns_400(self):
        """document_team user as target → 400 (not a sales_rep)."""
        resp = self.client.put(
            f'/api/v1/export/sales-rep-coverage/{self.doc_user.id}/',
            {'customer_ids': [self.cust.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('sales_rep', resp.data.get('error', ''))


# ---------------------------------------------------------------------------
# Test: PATCH /core/customers/{id}/ rejects non-sales_rep user assignment
# ---------------------------------------------------------------------------

class TestCustomerPatchSalesRepValidation(TestCase):
    """PATCH /api/v1/core/customers/{id}/ validate_sales_rep rejects wrong roles."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions', verbosity=0)
        # Superuser to bypass CustomerViewSet's write_permission gate.
        cls.superuser = _make_user('su_cust', 'admin')
        cls.superuser.is_superuser = True
        cls.superuser.save()
        cls.rep = _make_user('rep_cust', 'sales_rep')
        cls.doc_user = _make_user('doc_cust', 'document_team')
        cls.cust = _make_customer('CustPatch')

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.superuser)

    def test_patch_assigns_sales_rep(self):
        """PATCH with a valid sales_rep user ID succeeds."""
        resp = self.client.patch(
            f'/api/v1/core/customers/{self.cust.id}/',
            {'sales_rep': self.rep.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.cust.refresh_from_db()
        self.assertEqual(self.cust.sales_rep, self.rep)

    def test_patch_clears_sales_rep_with_null(self):
        """PATCH with sales_rep=null clears the assignment."""
        self.cust.sales_rep = self.rep
        self.cust.save()
        resp = self.client.patch(
            f'/api/v1/core/customers/{self.cust.id}/',
            {'sales_rep': None},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.cust.refresh_from_db()
        self.assertIsNone(self.cust.sales_rep)

    def test_patch_rejects_non_sales_rep_user(self):
        """PATCH with a user who is document_team → 400 (wrong role)."""
        resp = self.client.patch(
            f'/api/v1/core/customers/{self.cust.id}/',
            {'sales_rep': self.doc_user.id},
            format='json',
        )
        # The sales_rep field queryset filters role='sales_rep', so a non-rep PK
        # returns 400 with a 'does not exist' DRF validation error (not our custom
        # validate_sales_rep message, but still 400).
        self.assertEqual(resp.status_code, 400, resp.content)
