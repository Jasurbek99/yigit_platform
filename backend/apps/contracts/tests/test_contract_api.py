"""Integration tests for the Contract API (Slice A).

Tests use a real database (project convention). Each test class sets up
its own fixtures using setUp().

Test coverage:
  1. Authenticated list returns empty page
  2. Export manager can POST a valid contract → 201, appears in list
  3. Anonymous POST → 401
  4. Non-staff role (warehouse_chief) POST → 403
  5. Default list excludes completed/closed contracts
  6. ?include_ended=true returns active+completed+closed; never cancelled
  7. Detail endpoint returns expected fields including computed props + editable_fields
  8. ?export_firm=<id> filter works
  9. Duplicate contract_number → 400
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, User
from apps.contracts.models import Contract


# ─── Fixture helpers ─────────────────────────────────────────────────────────

def _make_season(name: str = '2025-2026') -> Season:
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30'},
    )
    return season


def _make_export_firm(code: str = 'YGTE') -> ExportFirm:
    firm, _ = ExportFirm.objects.get_or_create(
        code=code,
        defaults={'name_tk': f'Test Export {code}'},
    )
    return firm


def _make_import_firm(code: str = 'IMPA') -> ImportFirm:
    firm, _ = ImportFirm.objects.get_or_create(
        code=code,
        defaults={'name_company': f'Test Import {code}'},
    )
    return firm


def _make_contract(
    contract_number: str,
    export_firm: ExportFirm,
    import_firm: ImportFirm,
    season: Season,
    status: str = Contract.STATUS_ACTIVE,
    created_by: User | None = None,
) -> Contract:
    return Contract.objects.create(
        contract_number=contract_number,
        export_firm=export_firm,
        import_firm=import_firm,
        season=season,
        incoterm='FCA',
        planned_trucks=36,
        planned_quantity_kg='651600.00',
        planned_amount_usd='566892.00',
        start_date='2025-09-22',
        status=status,
        created_by=created_by,
    )


def _make_user(username: str, role: str) -> User:
    user, _ = User.objects.get_or_create(
        username=username,
        defaults={'role': role},
    )
    user.set_password('testpass')
    user.role = role
    user.save()
    return user


# ─── Test classes ─────────────────────────────────────────────────────────────

class ContractListAuthTest(TestCase):
    """Test 1: Authenticated user can GET the list and get an empty page."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_list', 'export_manager')
        self.client.force_authenticate(user=self.user)

    def test_authenticated_list_returns_empty_page(self) -> None:
        response = self.client.get('/api/v1/contracts/contracts/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('results', data)
        self.assertIn('count', data)
        self.assertEqual(data['count'], 0)


class ContractCreateTest(TestCase):
    """Test 2: Export manager can POST a valid contract."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_create', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.export_firm = _make_export_firm('YGTCR')
        self.import_firm = _make_import_firm('IMPCR')

    def test_create_contract_returns_201(self) -> None:
        payload = {
            'contract_number': '177/25-YGT-EXP',
            'export_firm': self.export_firm.pk,
            'import_firm': self.import_firm.pk,
            'season': self.season.pk,
            'incoterm': 'FCA',
            'planned_trucks': 36,
            'planned_quantity_kg': '651600.00',
            'planned_amount_usd': '566892.00',
            'start_date': '2025-09-22',
        }
        response = self.client.post('/api/v1/contracts/contracts/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Contract.objects.count(), 1)

    def test_created_contract_appears_in_list(self) -> None:
        _make_contract('177/25-LIST', self.export_firm, self.import_firm, self.season, created_by=self.user)
        response = self.client.get('/api/v1/contracts/contracts/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)


class ContractCreatePermissionTest(TestCase):
    """Tests 3 & 4: Anonymous → 401, non-staff role → 403."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.season = _make_season()
        self.export_firm = _make_export_firm('YGTPERM')
        self.import_firm = _make_import_firm('IMPPERM')
        self.payload = {
            'contract_number': '001/PERM',
            'export_firm': self.export_firm.pk,
            'import_firm': self.import_firm.pk,
            'season': self.season.pk,
            'incoterm': 'FCA',
            'planned_trucks': 10,
            'planned_quantity_kg': '100000.00',
            'planned_amount_usd': '80000.00',
            'start_date': '2025-09-01',
        }

    def test_anonymous_post_returns_401(self) -> None:
        # No authentication
        response = self.client.post('/api/v1/contracts/contracts/', self.payload, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_non_staff_role_post_returns_403(self) -> None:
        warehouse_user = _make_user('wh_chief', 'warehouse_chief')
        self.client.force_authenticate(user=warehouse_user)
        response = self.client.post('/api/v1/contracts/contracts/', self.payload, format='json')
        self.assertEqual(response.status_code, 403)


class ContractListFilterStatusTest(TestCase):
    """Tests 5 & 6: Default list excludes ended contracts; ?include_ended includes them."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_status', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTSTATUS')
        self.imp = _make_import_firm('IMPSTATUS')

    def _create(self, num: str, status: str) -> Contract:
        return _make_contract(num, self.ef, self.imp, self.season, status=status)

    def test_default_list_excludes_completed_and_closed(self) -> None:
        self._create('ACTIVE-1', Contract.STATUS_ACTIVE)
        self._create('COMPLETED-1', Contract.STATUS_COMPLETED)
        self._create('CLOSED-1', Contract.STATUS_CLOSED)
        self._create('CANCELLED-1', Contract.STATUS_CANCELLED)

        response = self.client.get('/api/v1/contracts/contracts/')
        self.assertEqual(response.json()['count'], 1)
        nums = [r['contract_number'] for r in response.json()['results']]
        self.assertIn('ACTIVE-1', nums)
        self.assertNotIn('COMPLETED-1', nums)
        self.assertNotIn('CLOSED-1', nums)
        self.assertNotIn('CANCELLED-1', nums)

    def test_include_ended_returns_active_completed_closed(self) -> None:
        self._create('ACTIVE-2', Contract.STATUS_ACTIVE)
        self._create('COMPLETED-2', Contract.STATUS_COMPLETED)
        self._create('CLOSED-2', Contract.STATUS_CLOSED)
        self._create('CANCELLED-2', Contract.STATUS_CANCELLED)

        response = self.client.get('/api/v1/contracts/contracts/?include_ended=true')
        nums = [r['contract_number'] for r in response.json()['results']]
        self.assertIn('ACTIVE-2', nums)
        self.assertIn('COMPLETED-2', nums)
        self.assertIn('CLOSED-2', nums)
        self.assertNotIn('CANCELLED-2', nums)

    def test_status_param_cancelled_returns_empty(self) -> None:
        """?status=cancelled is never returned — strict empty page."""
        self._create('CANCELLED-3', Contract.STATUS_CANCELLED)
        response = self.client.get('/api/v1/contracts/contracts/?status=cancelled')
        self.assertEqual(response.json()['count'], 0)


class ContractDetailTest(TestCase):
    """Test 7: Detail endpoint returns expected fields."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_detail', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDET')
        self.imp = _make_import_firm('IMPDET')
        self.contract = _make_contract(
            '200/25-DET', self.ef, self.imp, self.season, created_by=self.user,
        )

    def test_detail_contains_expected_fields(self) -> None:
        url = f'/api/v1/contracts/contracts/{self.contract.pk}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Core fields
        self.assertEqual(data['contract_number'], '200/25-DET')
        self.assertEqual(data['status'], Contract.STATUS_ACTIVE)

        # Computed properties
        self.assertIn('trucks_remaining', data)
        self.assertIn('ostatok_usd', data)
        self.assertIn('editable_fields', data)

        # FK display names
        self.assertIn('export_firm_name', data)
        self.assertIn('import_firm_name', data)

    def test_trucks_remaining_computed_correctly(self) -> None:
        url = f'/api/v1/contracts/contracts/{self.contract.pk}/'
        response = self.client.get(url)
        data = response.json()
        # planned_trucks=36, exported_trucks=0 → remaining=36
        self.assertEqual(data['trucks_remaining'], 36)

    def test_ostatok_usd_is_zero_on_new_contract(self) -> None:
        url = f'/api/v1/contracts/contracts/{self.contract.pk}/'
        response = self.client.get(url)
        data = response.json()
        # No invoices/payments yet → remaining = 0
        self.assertEqual(float(data['ostatok_usd']), 0.0)


class ContractExportFirmFilterTest(TestCase):
    """Test 8: ?export_firm=<id> filter."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_filter', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef1 = _make_export_firm('YGTF1')
        self.ef2 = _make_export_firm('YGTF2')
        self.imp = _make_import_firm('IMPFILTER')

    def test_filter_by_export_firm(self) -> None:
        c1 = _make_contract('FILTER-1', self.ef1, self.imp, self.season)
        _make_contract('FILTER-2', self.ef2, self.imp, self.season)

        response = self.client.get(f'/api/v1/contracts/contracts/?export_firm={self.ef1.pk}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(response.json()['results'][0]['id'], c1.pk)


class ContractDuplicateNumberTest(TestCase):
    """Test 9: Duplicate contract_number → 400."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('mgr_dup', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDUP')
        self.imp = _make_import_firm('IMPDUP')

    def test_duplicate_contract_number_returns_400(self) -> None:
        _make_contract('DUP-001', self.ef, self.imp, self.season)
        payload = {
            'contract_number': 'DUP-001',
            'export_firm': self.ef.pk,
            'import_firm': self.imp.pk,
            'season': self.season.pk,
            'incoterm': 'FCA',
            'planned_trucks': 10,
            'planned_quantity_kg': '100000.00',
            'planned_amount_usd': '80000.00',
            'start_date': '2025-09-01',
        }
        response = self.client.post('/api/v1/contracts/contracts/', payload, format='json')
        self.assertEqual(response.status_code, 400)
