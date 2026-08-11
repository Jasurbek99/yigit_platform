"""Idempotency smoke test for contract creation.

contract_number is minted server-side (seq/YY-FIRM-EXP), which is exactly why a
retry duplicates: the second attempt gets a NEW number, so the unique constraint
on contract_number never fires.

URL is /api/v1/contracts/contracts/ — config/urls.py:16 mounts the app at
api/v1/contracts/ and apps/contracts/urls.py:16 registers the router at
'contracts'.
"""
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.contracts.models import Contract
from apps.core.models import ExportFirm, ImportFirm, User

CONTRACTS_URL = '/api/v1/contracts/contracts/'


class ContractIdempotencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = User.objects.create_user(
            username='idem_ctr', password='pw', role='export_manager',
        )
        # ExportFirm has NO `name` field: `code` and `name_tk` are the required
        # ones (apps/core/models/firms.py:8-11).
        cls.export_firm = ExportFirm.objects.create(code='IDX', name_tk='IdemExport')
        cls.import_firm = ImportFirm.objects.create(name_company='IdemImport')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_repeated_contract_create_yields_one_contract(self):
        payload = {'export_firm': self.export_firm.id,
                   'import_firm': self.import_firm.id}
        r1 = self.client.post(CONTRACTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='ctr-key-000001')
        r2 = self.client.post(CONTRACTS_URL, payload, format='json',
                              HTTP_IDEMPOTENCY_KEY='ctr-key-000001')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r1.json()['contract_number'], r2.json()['contract_number'])
        self.assertEqual(Contract.objects.count(), 1)
