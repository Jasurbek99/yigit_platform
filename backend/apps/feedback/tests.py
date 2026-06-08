"""Minimal test suite for the Feedback Module.

Tests cover the core visibility, status, and file-validation rules.
All tests use Django's TestCase + APIClient.

Note: These tests run against the test MSSQL database (test_YIGIT_PLATFROM)
as configured in settings.py. If the test DB is unreachable, skip with:
    python manage.py test apps.feedback --skip-checks
"""
import io

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.models import User
from apps.feedback.models import FeedbackAttachment, FeedbackReply, FeedbackTicket
from apps.feedback.services.email import send_admin_new_ticket_email
from apps.feedback.services.files import validate_attachment
from rest_framework import serializers as drf_serializers


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='testpass', role=role)


def _make_ticket(author: User, **kwargs) -> FeedbackTicket:
    defaults = {
        'category': 'bug',
        'description': 'This is a test.',
        'status': 'new',
    }
    defaults.update(kwargs)
    return FeedbackTicket.objects.create(author=author, **defaults)


def _make_reply(ticket: FeedbackTicket, author: User, mode: str = 'standard') -> FeedbackReply:
    reply = FeedbackReply(ticket=ticket, author=author, content='Test reply.', mode=mode)
    reply.save()
    return reply


def _png_bytes(size: int = 100) -> io.BytesIO:
    """Return a minimal valid PNG file as BytesIO."""
    # Minimal PNG header (PNG magic bytes)
    data = b'\x89PNG\r\n\x1a\n' + b'\x00' * (size - 8)
    buf = io.BytesIO(data)
    buf.name = 'screenshot.png'
    buf.size = len(data)
    buf.content_type = 'image/png'
    return buf


def _fake_file(content: bytes, name: str = 'file.png', content_type: str = 'image/png'):
    """Return a minimal file-like object for validate_attachment."""

    class FakeFile:
        def __init__(self):
            self._buf = io.BytesIO(content)
            self.name = name
            self.size = len(content)
            self.content_type = content_type

        def seek(self, pos):
            self._buf.seek(pos)

        def read(self, n=-1):
            return self._buf.read(n)

    return FakeFile()


# ── Visibility tests ──────────────────────────────────────────────────────────

class TicketVisibilityTests(TestCase):
    """Verify that ticket list / detail visibility rules are enforced correctly."""

    def setUp(self):
        self.author = _make_user('author_user', 'sales_rep')
        self.peer = _make_user('peer_user', 'transport')
        self.admin = _make_user('admin_user', 'admin')
        self.ticket = _make_ticket(self.author)

    def _login(self, user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_author_sees_own_ticket_in_list(self):
        """Non-admin author sees their own ticket under ?scope=mine."""
        client = self._login(self.author)
        resp = client.get('/api/v1/feedback/tickets/?scope=mine')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r['id'] for r in resp.data['results']]
        self.assertIn(self.ticket.id, ids)

    def test_peer_cannot_see_private_ticket_in_list(self):
        """Non-admin peer does not see another user's private ticket."""
        client = self._login(self.peer)
        resp = client.get('/api/v1/feedback/tickets/?scope=mine')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r['id'] for r in resp.data['results']]
        self.assertNotIn(self.ticket.id, ids)

    def test_public_ticket_visible_via_scope_public(self):
        """A ticket promoted to is_public=True appears in ?scope=public for any user."""
        self.ticket.is_public = True
        self.ticket.save()

        client = self._login(self.peer)
        resp = client.get('/api/v1/feedback/tickets/?scope=public')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r['id'] for r in resp.data['results']]
        self.assertIn(self.ticket.id, ids)

    def test_admin_sees_all_tickets(self):
        """Admin sees all tickets in the default (no scope) list."""
        client = self._login(self.admin)
        resp = client.get('/api/v1/feedback/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [r['id'] for r in resp.data['results']]
        self.assertIn(self.ticket.id, ids)

    def test_peer_cannot_retrieve_private_ticket_by_id(self):
        """Peer cannot retrieve a private (non-public) ticket by guessing the URL.

        Locks in the visibility guarantee: a future refactor must not silently
        expose private tickets via direct URL access.
        """
        # self.ticket is a private ticket (is_public=False) owned by self.author
        self.assertFalse(self.ticket.is_public)
        client = self._login(self.peer)
        resp = client.get(f'/api/v1/feedback/tickets/{self.ticket.id}/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_cannot_set_is_public_via_patch(self):
        """PATCH with is_public=true is rejected with 400; ticket stays private."""
        client = self._login(self.admin)
        resp = client.patch(
            f'/api/v1/feedback/tickets/{self.ticket.id}/',
            {'is_public': True, 'status': 'resolved'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.ticket.refresh_from_db()
        self.assertFalse(self.ticket.is_public)


# ── Reply visibility tests ─────────────────────────────────────────────────────

class ReplyVisibilityTests(TestCase):
    """Verify that internal notes are hidden from non-admin users."""

    def setUp(self):
        self.author = _make_user('reply_author', 'finansist')
        self.admin = _make_user('reply_admin', 'admin')
        self.peer = _make_user('reply_peer', 'warehouse_chief')
        self.ticket = _make_ticket(self.author, is_public=True)
        self.standard_reply = _make_reply(self.ticket, self.admin, mode='standard')
        self.internal_reply = _make_reply(self.ticket, self.admin, mode='internal')
        self.public_reply = _make_reply(self.ticket, self.admin, mode='public')

    def _get_reply_modes(self, viewer: User) -> list[str]:
        client = APIClient()
        client.force_authenticate(user=viewer)
        resp = client.get(f'/api/v1/feedback/tickets/{self.ticket.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return [r['mode'] for r in resp.data['replies']]

    def test_author_sees_non_internal_replies(self):
        """Author sees standard and public replies but NOT internal notes."""
        modes = self._get_reply_modes(self.author)
        self.assertIn('standard', modes)
        self.assertIn('public', modes)
        self.assertNotIn('internal', modes)

    def test_admin_sees_all_replies_including_internal(self):
        """Admin sees standard, internal, and public replies."""
        modes = self._get_reply_modes(self.admin)
        self.assertIn('standard', modes)
        self.assertIn('internal', modes)
        self.assertIn('public', modes)

    def test_public_viewer_sees_only_public_replies(self):
        """Public (non-author, non-admin) viewer sees only is_public replies."""
        # peer is neither admin nor author — accesses via ?scope=public
        client = APIClient()
        client.force_authenticate(user=self.peer)
        resp = client.get(f'/api/v1/feedback/tickets/{self.ticket.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        modes = [r['mode'] for r in resp.data['replies']]
        self.assertNotIn('standard', modes)
        self.assertNotIn('internal', modes)
        self.assertIn('public', modes)


# ── Status transition tests ───────────────────────────────────────────────────

class ReplyPublicPromotionTest(TestCase):
    """Verify that replying with mode='public' promotes ticket.is_public."""

    def test_public_reply_flips_ticket_is_public(self):
        """POST /tickets/{id}/reply/ with mode='public' sets ticket.is_public=True."""
        admin = _make_user('promo_admin', 'admin')
        author = _make_user('promo_author', 'export_manager')
        ticket = _make_ticket(author)
        self.assertFalse(ticket.is_public)

        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.post(
            f'/api/v1/feedback/tickets/{ticket.id}/reply/',
            data={'content': 'This is public.', 'mode': 'public'},
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        ticket.refresh_from_db()
        self.assertTrue(ticket.is_public)


class ReopenTest(TestCase):
    """Verify that the author can reopen a resolved ticket."""

    def test_author_can_reopen_resolved_ticket(self):
        """POST /tickets/{id}/reopen/ moves resolved → in_review."""
        author = _make_user('reopen_author', 'document_team')
        ticket = _make_ticket(author, status='resolved')

        client = APIClient()
        client.force_authenticate(user=author)
        resp = client.post(f'/api/v1/feedback/tickets/{ticket.id}/reopen/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        ticket.refresh_from_db()
        self.assertEqual(ticket.status, 'in_review')
        self.assertIsNone(ticket.resolved_at)

    def test_non_author_cannot_reopen(self):
        """POST /tickets/{id}/reopen/ by a peer (non-author) returns 404.

        The viewset's get_queryset for the reopen action filters to author=user,
        so a peer's request sees an empty queryset and get_object() raises Http404
        before reaching the 403 guard. 404 is correct: it never reveals existence
        of another user's private ticket ('404 not 403' philosophy in viewset docstring).
        """
        author = _make_user('ro_author', 'document_team')
        peer = _make_user('ro_peer', 'transport')
        ticket = _make_ticket(author, status='resolved')

        client = APIClient()
        client.force_authenticate(user=peer)
        resp = client.post(f'/api/v1/feedback/tickets/{ticket.id}/reopen/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_reopen_new_ticket(self):
        """POST /tickets/{id}/reopen/ on a 'new' ticket is rejected."""
        author = _make_user('ro_new_author', 'accountant')
        ticket = _make_ticket(author, status='new')

        client = APIClient()
        client.force_authenticate(user=author)
        resp = client.post(f'/api/v1/feedback/tickets/{ticket.id}/reopen/')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ── File validation tests ─────────────────────────────────────────────────────

class FileValidationTests(TestCase):
    """Verify magic-byte and size checks in services/files.py."""

    def test_valid_png_passes(self):
        """A file with valid PNG magic bytes passes validation."""
        f = _fake_file(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100, 'ok.png', 'image/png')
        # Should not raise
        validate_attachment(f)

    def test_oversize_file_rejected(self):
        """A file exceeding 5MB is rejected."""
        oversize = b'\x89PNG\r\n\x1a\n' + b'\x00' * (5 * 1024 * 1024 + 1)
        f = _fake_file(oversize, 'big.png', 'image/png')
        with self.assertRaises(drf_serializers.ValidationError):
            validate_attachment(f)

    def test_wrong_magic_bytes_rejected(self):
        """A file with .png extension but wrong magic bytes (EXE header) is rejected."""
        exe_header = b'MZ' + b'\x00' * 100  # EXE magic bytes
        f = _fake_file(exe_header, 'fake.png', 'image/png')
        with self.assertRaises(drf_serializers.ValidationError):
            validate_attachment(f)

    def test_disallowed_extension_rejected(self):
        """A file with a disallowed extension (.pdf) is rejected."""
        # Use valid PNG magic bytes but .pdf extension
        f = _fake_file(b'\x89PNG\r\n\x1a\n' + b'\x00' * 50, 'document.pdf', 'application/pdf')
        with self.assertRaises(drf_serializers.ValidationError):
            validate_attachment(f)

    def test_valid_jpeg_passes(self):
        """A file with valid JPEG magic bytes passes validation."""
        f = _fake_file(b'\xff\xd8\xff' + b'\x00' * 100, 'photo.jpg', 'image/jpeg')
        validate_attachment(f)

    def test_valid_gif_passes(self):
        """A file with valid GIF89a magic bytes passes validation."""
        f = _fake_file(b'GIF89a' + b'\x00' * 100, 'anim.gif', 'image/gif')
        validate_attachment(f)


# ── Email service tests ───────────────────────────────────────────────────────

class EmailServiceTests(TestCase):
    """Verify email service: no exception when no admin recipients configured."""

    def test_no_exception_with_no_recipients(self):
        """send_admin_new_ticket_email() with no admin users and no env var is silent."""
        author = _make_user('email_author', 'greenhouse_manager')
        ticket = _make_ticket(author)

        # Ensure no admin users exist and FEEDBACK_ADMIN_EMAIL is blank
        with self.settings(FEEDBACK_ADMIN_EMAIL='', PLATFORM_URL=''):
            # Should not raise anything
            try:
                send_admin_new_ticket_email(ticket)
            except Exception as exc:
                self.fail(f"send_admin_new_ticket_email raised unexpectedly: {exc}")
