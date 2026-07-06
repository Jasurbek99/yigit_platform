"""Integration tests for contract document attachments (PDF upload/download/delete).

Covers:
  1. Export manager uploads a valid PDF → 201, appears nested in detail
  2. Non-PDF content (magic-byte mismatch) → 400, nothing persisted
  3. Download streams the file inline (Content-Disposition: inline)
  4. Delete removes the attachment → 204, gone from detail
  5. Read-only role (boss) cannot upload → 403
"""
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, ImportFirm, Season, User
from apps.contracts.models import Contract, ContractAttachment

_PDF_BYTES = b'%PDF-1.4\n%fake pdf body for tests\n'


class _SeededPermsMixin:
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        call_command('seed_permissions')

    def tearDown(self) -> None:
        cache.clear()
        super().tearDown()


def _make_user(username: str, role: str) -> User:
    user, _ = User.objects.get_or_create(username=username, defaults={'role': role})
    user.role = role
    user.set_password('testpass')
    user.save()
    return user


def _make_contract(created_by: User) -> Contract:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30'},
    )
    export_firm, _ = ExportFirm.objects.get_or_create(
        code='YGTAT', defaults={'name_tk': 'Test Export'},
    )
    import_firm, _ = ImportFirm.objects.get_or_create(
        code='IMPAT', defaults={'name_company': 'Test Import'},
    )
    return Contract.objects.create(
        contract_number='ATT/25-YGT',
        export_firm=export_firm,
        import_firm=import_firm,
        season=season,
        incoterm='FCA',
        planned_trucks=10,
        planned_quantity_kg='100000.00',
        planned_amount_usd='90000.00',
        start_date='2025-09-22',
        created_by=created_by,
    )


def _pdf(name: str = 'contract.pdf') -> SimpleUploadedFile:
    return SimpleUploadedFile(name, _PDF_BYTES, content_type='application/pdf')


class ContractAttachmentUploadTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('att_mgr', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.contract = _make_contract(self.user)

    def _url(self) -> str:
        return f'/api/v1/contracts/contracts/{self.contract.pk}/attachments/'

    def test_upload_valid_pdf_returns_201(self) -> None:
        resp = self.client.post(self._url(), {'files': _pdf()}, format='multipart')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(ContractAttachment.objects.filter(contract=self.contract).count(), 1)
        body = resp.json()
        self.assertEqual(body[0]['original_filename'], 'contract.pdf')
        self.assertEqual(body[0]['uploaded_by'], self.user.pk)

    def test_uploaded_pdf_appears_in_detail(self) -> None:
        self.client.post(self._url(), {'files': _pdf('annex.pdf')}, format='multipart')
        resp = self.client.get(f'/api/v1/contracts/contracts/{self.contract.pk}/')
        self.assertEqual(resp.status_code, 200)
        attachments = resp.json()['attachments']
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]['original_filename'], 'annex.pdf')

    def test_non_pdf_rejected_400(self) -> None:
        fake = SimpleUploadedFile('evil.pdf', b'GIF89a not a pdf', content_type='application/pdf')
        resp = self.client.post(self._url(), {'files': fake}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(ContractAttachment.objects.count(), 0)

    def test_no_files_returns_400(self) -> None:
        resp = self.client.post(self._url(), {}, format='multipart')
        self.assertEqual(resp.status_code, 400)


class ContractAttachmentDownloadDeleteTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = _make_user('att_dl', 'export_manager')
        self.client.force_authenticate(user=self.user)
        self.contract = _make_contract(self.user)
        self.attachment = ContractAttachment.objects.create(
            contract=self.contract,
            file=_pdf(),
            original_filename='contract.pdf',
            mime_type='application/pdf',
            size_bytes=len(_PDF_BYTES),
            uploaded_by=self.user,
        )

    def test_download_streams_inline(self) -> None:
        url = (
            f'/api/v1/contracts/contracts/{self.contract.pk}'
            f'/attachments/{self.attachment.pk}/download/'
        )
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'application/pdf')
        self.assertIn('inline', resp['Content-Disposition'])

    def test_delete_removes_attachment(self) -> None:
        url = (
            f'/api/v1/contracts/contracts/{self.contract.pk}'
            f'/attachments/{self.attachment.pk}/'
        )
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(ContractAttachment.objects.count(), 0)

    def test_download_works_on_completed_contract(self) -> None:
        # Contract documents are legal records still needed after completion —
        # the list-only status filter must not block detail/attachment access.
        self.contract.status = Contract.STATUS_COMPLETED
        self.contract.save()
        url = (
            f'/api/v1/contracts/contracts/{self.contract.pk}'
            f'/attachments/{self.attachment.pk}/download/'
        )
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)


class ContractAttachmentPermissionTest(_SeededPermsMixin, TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        owner = _make_user('att_owner', 'export_manager')
        self.contract = _make_contract(owner)
        self.boss = _make_user('att_boss', 'boss')  # view-only on contract
        self.client.force_authenticate(user=self.boss)

    def test_readonly_role_cannot_upload(self) -> None:
        url = f'/api/v1/contracts/contracts/{self.contract.pk}/attachments/'
        resp = self.client.post(url, {'files': _pdf()}, format='multipart')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(ContractAttachment.objects.count(), 0)
