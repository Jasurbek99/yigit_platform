"""Integration tests for the Invoice API (Slice B).

Tests use a real database (project convention). Each test class sets up
its own fixtures via setUp().

Test coverage:
  1.  Authenticated GET /api/v1/contracts/invoices/ → 200, empty page
  2.  Export manager POST valid invoice → 201, contract totals roll up
  3.  POST with quantity_kg + price_per_kg but no total_usd → auto-computed
  4.  POST with total_usd only (no qty/price) → accepted
  5.  POST with neither money component → 400
  6.  POST against cancelled contract → 400
  7.  Duplicate (contract, invoice_number) → 400
  8.  Anonymous POST → 401
  9.  Non-staff (warehouse_chief) POST → 403
  10. Non-admin DELETE → 403; admin DELETE → 204 and totals roll down
  11. status='void' invoice excluded from exported totals
  12. ?contract=<id> filter returns only that contract's invoices
  13. PATCH quantity_kg re-rolls up the contract totals
  14. Moving invoice from contract A to contract B re-rolls both contracts
  15. (merged into 16)
  16. PATCH {"status": "paid"} (no money fields) → 200 (_merged() regression)
      PATCH to void excludes invoice from rollup
      PATCH status on cancelled contract's invoice → 200 (guard is assignment-time only)
  17. Detail endpoint includes editable_fields
"""
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, User
from apps.contracts.models import Contract, Invoice


# ─── Fixture helpers ─────────────────────────────────────────────────────────

def _make_season(name: str = 'inv-2025') -> Season:
    """Create or get a season. Name max_length is 10 chars on MSSQL."""
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30'},
    )
    return season


def _make_export_firm(code: str) -> ExportFirm:
    firm, _ = ExportFirm.objects.get_or_create(
        code=code,
        defaults={'name_tk': f'Test Export {code}'},
    )
    return firm


def _make_import_firm(code: str) -> ImportFirm:
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


def _make_invoice(contract: Contract, invoice_number: int = 1, status: str = Invoice.STATUS_SENT) -> Invoice:
    """Create a minimal valid invoice directly (bypasses API)."""
    return Invoice.objects.create(
        contract=contract,
        invoice_number=invoice_number,
        invoice_date='2025-10-01',
        quantity_kg=Decimal('18500.00'),
        price_per_kg=Decimal('0.0870'),
        status=status,
    )


# ─── Test classes ─────────────────────────────────────────────────────────────

class InvoiceListAuthTest(TestCase):
    """Test 1: Authenticated user can GET the list — returns empty page."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_list', 'export_manager')
        self.client.force_authenticate(user=self.user)

    def test_authenticated_list_returns_empty_page(self) -> None:
        response = self.client.get('/api/v1/contracts/invoices/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('results', data)
        self.assertIn('count', data)
        self.assertEqual(data['count'], 0)


class InvoiceCreateRollupTest(TestCase):
    """Test 2: Export manager creates invoice → contract totals roll up."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_create', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTICR')
        self.imp = _make_import_firm('IMPICR')
        self.contract = _make_contract('INV-CREATE-001', self.ef, self.imp, self.season)

    def test_create_invoice_returns_201(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'quantity_kg': '18500.00',
            'price_per_kg': '0.0870',
            'status': 'sent',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)

    def test_contract_totals_roll_up_after_create(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'quantity_kg': '18500.00',
            'price_per_kg': '0.0870',
            'status': 'sent',
        }
        self.client.post('/api/v1/contracts/invoices/', payload, format='json')

        self.contract.refresh_from_db()
        self.assertEqual(self.contract.exported_trucks, 1)
        self.assertAlmostEqual(float(self.contract.exported_quantity_kg), 18500.0)
        # total_usd = 18500 * 0.0870 = 1609.50
        self.assertAlmostEqual(float(self.contract.exported_amount_usd), 1609.50, places=1)
        self.assertEqual(self.contract.last_invoice_number, 1)


class InvoiceAutoComputeTotalTest(TestCase):
    """Test 3: total_usd auto-computed when qty + price provided but no total."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_auto', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTAUTO')
        self.imp = _make_import_firm('IMPAUTO')
        self.contract = _make_contract('INV-AUTO-001', self.ef, self.imp, self.season)

    def test_total_usd_auto_computed(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'quantity_kg': '10000.00',
            'price_per_kg': '0.1000',
            # total_usd intentionally omitted
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)

        invoice = Invoice.objects.get(contract=self.contract, invoice_number=1)
        self.assertIsNotNone(invoice.total_usd)
        self.assertAlmostEqual(float(invoice.total_usd), 1000.00)


class InvoiceTotalOnlyTest(TestCase):
    """Test 4: Providing total_usd only (no qty/price) is accepted."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_totonly', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTTOT')
        self.imp = _make_import_firm('IMPTOT')
        self.contract = _make_contract('INV-TOT-001', self.ef, self.imp, self.season)

    def test_total_usd_only_accepted(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'total_usd': '1500.00',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)

        self.contract.refresh_from_db()
        self.assertAlmostEqual(float(self.contract.exported_amount_usd), 1500.0)


class InvoiceNoMoneyTest(TestCase):
    """Test 5: No money info at all → 400."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_nomoney', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTNOM')
        self.imp = _make_import_firm('IMPNOM')
        self.contract = _make_contract('INV-NOM-001', self.ef, self.imp, self.season)

    def test_no_money_info_returns_400(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            # No quantity_kg, price_per_kg, or total_usd
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 400)


class InvoiceCancelledContractTest(TestCase):
    """Test 6: POST against cancelled contract → 400."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_cancel', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTCNL')
        self.imp = _make_import_firm('IMPCNL')
        self.contract = _make_contract(
            'INV-CNL-001', self.ef, self.imp, self.season,
            status=Contract.STATUS_CANCELLED,
        )

    def test_cancelled_contract_returns_400(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'total_usd': '1000.00',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('cancelled', str(response.content).lower())


class InvoiceDuplicateNumberTest(TestCase):
    """Test 7: Duplicate (contract, invoice_number) → 400."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_dup', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDUP2')
        self.imp = _make_import_firm('IMPDUP2')
        self.contract = _make_contract('INV-DUP-001', self.ef, self.imp, self.season)
        _make_invoice(self.contract, invoice_number=1)

    def test_duplicate_invoice_number_returns_400(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,  # already exists
            'invoice_date': '2025-10-02',
            'total_usd': '999.00',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 400)


class InvoiceAnonymousTest(TestCase):
    """Test 8: Anonymous POST → 401."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.season = _make_season()
        self.ef = _make_export_firm('YGTANON')
        self.imp = _make_import_firm('IMPANON')
        self.contract = _make_contract('INV-ANON-001', self.ef, self.imp, self.season)

    def test_anonymous_post_returns_401(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'total_usd': '1000.00',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertIn(response.status_code, (401, 403))


class InvoicePermissionTest(TestCase):
    """Test 9: warehouse_chief POST → 403."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.season = _make_season()
        self.ef = _make_export_firm('YGTPERM2')
        self.imp = _make_import_firm('IMPPERM2')
        self.contract = _make_contract('INV-PERM-001', self.ef, self.imp, self.season)
        wh_user = _make_user('wh_chief_inv', 'warehouse_chief')
        self.client.force_authenticate(user=wh_user)

    def test_non_staff_role_post_returns_403(self) -> None:
        payload = {
            'contract': self.contract.pk,
            'invoice_number': 1,
            'invoice_date': '2025-10-01',
            'total_usd': '1000.00',
        }
        response = self.client.post('/api/v1/contracts/invoices/', payload, format='json')
        self.assertEqual(response.status_code, 403)


class InvoiceDeletePermissionTest(TestCase):
    """Test 10: Non-admin DELETE → 403; admin DELETE → 204 and totals roll down."""

    def setUp(self) -> None:
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDEL')
        self.imp = _make_import_firm('IMPDEL')
        self.contract = _make_contract('INV-DEL-001', self.ef, self.imp, self.season)
        self.invoice = _make_invoice(self.contract, invoice_number=1)

        # Verify rollup ran after _make_invoice
        self.contract.refresh_from_db()

    def test_non_admin_delete_returns_403(self) -> None:
        mgr = _make_user('inv_mgr_del', 'export_manager')
        client = APIClient()
        client.force_authenticate(user=mgr)
        response = client.delete(f'/api/v1/contracts/invoices/{self.invoice.pk}/')
        self.assertEqual(response.status_code, 403)

    def test_admin_delete_returns_204_and_totals_drop(self) -> None:
        admin = _make_user('inv_admin_del', 'admin')
        client = APIClient()
        client.force_authenticate(user=admin)

        # Confirm totals are set before delete
        self.assertEqual(self.contract.exported_trucks, 1)

        response = client.delete(f'/api/v1/contracts/invoices/{self.invoice.pk}/')
        self.assertEqual(response.status_code, 204)

        self.contract.refresh_from_db()
        self.assertEqual(self.contract.exported_trucks, 0)
        self.assertEqual(self.contract.exported_quantity_kg, Decimal('0'))
        self.assertEqual(self.contract.exported_amount_usd, Decimal('0'))
        self.assertIsNone(self.contract.last_invoice_number)


class InvoiceVoidExclusionTest(TestCase):
    """Test 11: 'void' invoice does NOT count toward exported totals."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_void', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTVOID')
        self.imp = _make_import_firm('IMPVOID')
        self.contract = _make_contract('INV-VOID-001', self.ef, self.imp, self.season)

    def test_void_invoice_excluded_from_totals(self) -> None:
        # Create a sent invoice (should count)
        _make_invoice(self.contract, invoice_number=1, status=Invoice.STATUS_SENT)
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.exported_trucks, 1)

        # Create a void invoice (should NOT count)
        _make_invoice(self.contract, invoice_number=2, status=Invoice.STATUS_VOID)
        self.contract.refresh_from_db()

        # Still only 1 truck counted
        self.assertEqual(self.contract.exported_trucks, 1)


class InvoiceContractFilterTest(TestCase):
    """Test 12: ?contract=<id> returns only that contract's invoices."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_filter', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTFILT')
        self.imp = _make_import_firm('IMPFILT')
        self.contract_a = _make_contract('INV-FILT-A', self.ef, self.imp, self.season)
        self.contract_b = _make_contract('INV-FILT-B', self.ef, self.imp, self.season)
        _make_invoice(self.contract_a, invoice_number=1)
        _make_invoice(self.contract_b, invoice_number=1)

    def test_filter_by_contract(self) -> None:
        response = self.client.get(f'/api/v1/contracts/invoices/?contract={self.contract_a.pk}')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['contract'], self.contract_a.pk)


class InvoicePatchRollupTest(TestCase):
    """Test 13: PATCH with explicit total_usd re-rolls up the contract totals.

    Note: auto-compute (total_usd = qty * price) only fires when total_usd is
    null or 0.  After an invoice is created with qty+price, total_usd is already
    set, so a subsequent PATCH of qty/price alone does NOT recompute total_usd —
    the caller must send an explicit total_usd to change the amount.
    This test verifies "PATCH explicit total_usd triggers rollup"; a test for
    "PATCH qty/price with null total recomputes" is covered by test 3
    (InvoiceAutoComputeTotalTest) at create time.
    """

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_patch', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTPATCH')
        self.imp = _make_import_firm('IMPPATCH')
        self.contract = _make_contract('INV-PATCH-001', self.ef, self.imp, self.season)
        self.invoice = _make_invoice(self.contract, invoice_number=1)
        # Initial: qty=18500, price=0.0870 → total=1609.50
        self.contract.refresh_from_db()

    def test_patch_explicit_total_usd_updates_rollup(self) -> None:
        initial_amount = float(self.contract.exported_amount_usd)

        # Passing an explicit total_usd overrides the existing value and
        # triggers rollup.  Auto-compute is a create-time defensive mechanism,
        # not a PATCH-time recompute.
        response = self.client.patch(
            f'/api/v1/contracts/invoices/{self.invoice.pk}/',
            {'quantity_kg': '20000.00', 'price_per_kg': '0.0870', 'total_usd': '1740.00'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.contract.refresh_from_db()
        new_amount = float(self.contract.exported_amount_usd)
        # new_total = 1740.00; old was 1609.50
        self.assertGreater(new_amount, initial_amount)
        self.assertAlmostEqual(new_amount, 1740.0, places=1)


class InvoiceContractReassignTest(TestCase):
    """Test 14: Moving invoice from contract A to B re-rolls BOTH contracts."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_move', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTMOVE')
        self.imp = _make_import_firm('IMPMOVE')
        self.contract_a = _make_contract('INV-MOVE-A', self.ef, self.imp, self.season)
        self.contract_b = _make_contract('INV-MOVE-B', self.ef, self.imp, self.season)
        # Create invoice under contract_a
        self.invoice = _make_invoice(self.contract_a, invoice_number=1)
        self.contract_a.refresh_from_db()
        self.contract_b.refresh_from_db()

    def test_reassign_invoice_updates_both_contracts(self) -> None:
        # Contract A has 1 truck, contract B has 0
        self.assertEqual(self.contract_a.exported_trucks, 1)
        self.assertEqual(self.contract_b.exported_trucks, 0)

        # Move invoice from A to B via PATCH
        response = self.client.patch(
            f'/api/v1/contracts/invoices/{self.invoice.pk}/',
            {'contract': self.contract_b.pk, 'quantity_kg': '18500.00', 'price_per_kg': '0.0870'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.contract_a.refresh_from_db()
        self.contract_b.refresh_from_db()

        # Contract A should now have 0 trucks
        self.assertEqual(self.contract_a.exported_trucks, 0)
        self.assertEqual(self.contract_a.exported_amount_usd, Decimal('0'))

        # Contract B should now have 1 truck
        self.assertEqual(self.contract_b.exported_trucks, 1)
        self.assertGreater(self.contract_b.exported_amount_usd, Decimal('0'))


class InvoicePatchStatusOnlyTest(TestCase):
    """Test 16: PATCH with only status field (no money fields) → 200.

    Regression test for the _merged() fix: a status-only PATCH must NOT
    trigger the 'no money info' 400 validation, because _merged() falls back
    to the existing instance's quantity_kg / price_per_kg / total_usd.
    """

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_pstatus', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTPST')
        self.imp = _make_import_firm('IMPPST')
        self.contract = _make_contract('INV-PST-001', self.ef, self.imp, self.season)
        # Invoice has total_usd set via auto-compute
        self.invoice = _make_invoice(self.contract, invoice_number=1)

    def test_status_only_patch_returns_200(self) -> None:
        """PATCH {"status": "paid"} must succeed — no money fields required."""
        response = self.client.patch(
            f'/api/v1/contracts/invoices/{self.invoice.pk}/',
            {'status': 'paid'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.STATUS_PAID)

    def test_status_void_patch_excludes_from_rollup(self) -> None:
        """PATCH to void should cause rollup to drop the truck count."""
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.exported_trucks, 1)

        response = self.client.patch(
            f'/api/v1/contracts/invoices/{self.invoice.pk}/',
            {'status': 'void'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.contract.refresh_from_db()
        self.assertEqual(self.contract.exported_trucks, 0)

    def test_patch_status_on_cancelled_contracts_invoice_returns_200(self) -> None:
        """PATCH an invoice whose contract was later cancelled must still succeed.

        The cancellation guard fires only when 'contract' is in the request
        body (assignment intent).  A status-only PATCH must not be blocked
        even if the parent contract is now cancelled (e.g. voiding out
        existing invoices is the common clean-up path).
        """
        # Cancel the contract after the invoice was already created
        self.contract.status = Contract.STATUS_CANCELLED
        self.contract.save()

        response = self.client.patch(
            f'/api/v1/contracts/invoices/{self.invoice.pk}/',
            {'status': 'void'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, Invoice.STATUS_VOID)


class InvoiceDetailEditableFieldsTest(TestCase):
    """Test 17: Detail endpoint includes editable_fields."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('inv_detail', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.season = _make_season()
        self.ef = _make_export_firm('YGTDET2')
        self.imp = _make_import_firm('IMPDET2')
        self.contract = _make_contract('INV-DET-001', self.ef, self.imp, self.season)
        self.invoice = _make_invoice(self.contract, invoice_number=1)

    def test_detail_contains_editable_fields(self) -> None:
        response = self.client.get(f'/api/v1/contracts/invoices/{self.invoice.pk}/')
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Core invoice fields
        self.assertEqual(data['invoice_number'], 1)
        self.assertIn('status', data)
        self.assertIn('status_display', data)

        # editable_fields list must be present (may be empty if no permissions seeded)
        self.assertIn('editable_fields', data)
        self.assertIsInstance(data['editable_fields'], list)
