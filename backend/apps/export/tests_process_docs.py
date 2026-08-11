"""Tests for the boss process-doc endpoint.

Covers:
- Boss user gets 200 + text/html + distinctive body content for each valid slug
- Unknown slug -> 404
- Path-traversal attempts -> 404, no content leak
- A real, existing, but unlisted file under docs/how_works/ -> 404, no content leak
  (the discriminating traversal case: catches a whitelist-to-path-joining regression
  that the "unknown slug" and dotdot cases above do not, since none of those resolve
  to a real file on disk under naive path-joining)
- Non-boss/director role -> 403 (permission class regression guard)
- Missing ?doc= -> 404. Chosen over 400 because the whitelist lookup treats a missing
  and an unknown slug identically (dict.get() returns None either way) and there is
  no sensible default document to fall back to, unlike the sibling export_excel/
  export_pdf actions which default an unrecognised ?section= to 'monthly'.

GET /api/v1/export/boss/process-doc/?doc=<slug>
"""
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import User
from apps.export.views_analytics import _PROCESS_DOCS, _PROCESS_DOCS_DIR


class ProcessDocsPackagingTests(TestCase):
    """The whitelisted documents must exist where the app looks for them.

    Guards the packaging seam. `_PROCESS_DOCS_DIR` used to be derived as
    ``BASE_DIR.parent / 'docs' / 'how_works'``, which resolves correctly in a
    repo checkout and to a nonexistent ``/docs/how_works`` inside the Docker
    image (only ``backend/`` lands at ``/app``, so ``BASE_DIR.parent`` is
    ``/``). Every endpoint test above passed while both documents 404'd in the
    deployed container.

    This asserts the directory and each whitelisted filename resolve to a real
    file. It cannot inspect the built image, so it catches a wrong
    ``PROCESS_DOCS_DIR`` / a renamed-or-deleted source document, not a
    Dockerfile that forgets the COPY. Only a container smoke test closes that.
    """

    def test_process_docs_dir_exists(self) -> None:
        """The configured directory resolves to a real directory."""
        self.assertTrue(
            _PROCESS_DOCS_DIR.is_dir(),
            f'PROCESS_DOCS_DIR does not exist: {_PROCESS_DOCS_DIR}',
        )

    def test_every_whitelisted_document_is_present_on_disk(self) -> None:
        """Each ?doc= slug maps to a file that is actually there."""
        for slug, filename in _PROCESS_DOCS.items():
            with self.subTest(slug=slug):
                path = _PROCESS_DOCS_DIR / filename
                self.assertTrue(
                    path.is_file(),
                    f'?doc={slug} points at a missing file: {path}',
                )
                self.assertGreater(path.stat().st_size, 0, f'{path} is empty')


def _create_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class ProcessDocEndpointTests(TestCase):

    URL = '/api/v1/export/boss/process-doc/'

    def setUp(self):
        self.client = APIClient()
        self.boss = _create_user('boss_pd', 'boss')
        self.export_mgr = _create_user('mgr_pd', 'export_manager')

    def _get(self, user, query: str):
        self.client.force_authenticate(user=user)
        return self.client.get(f'{self.URL}{query}')

    # -- happy path: two valid slugs, distinct content ------------------

    def test_shipment_process_boss_returns_correct_document(self):
        resp = self._get(self.boss, '?doc=shipment-process-boss')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/html; charset=utf-8')
        body = resp.content.decode('utf-8')
        self.assertIn('How a Shipment Works', body)
        self.assertNotIn('Export Shipment — BPMN', body)

    def test_shipment_bpmn_returns_correct_document(self):
        resp = self._get(self.boss, '?doc=shipment-bpmn')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/html; charset=utf-8')
        body = resp.content.decode('utf-8')
        self.assertIn('Export Shipment — BPMN', body)
        self.assertNotIn('How a Shipment Works', body)

    # -- unknown slug -----------------------------------------------------

    def test_unknown_slug_returns_404(self):
        resp = self._get(self.boss, '?doc=nonexistent-doc')
        self.assertEqual(resp.status_code, 404)

    # -- path traversal ---------------------------------------------------

    def test_path_traversal_dotdot_rejected(self):
        resp = self._get(self.boss, '?doc=../../manage.py')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(b'BASE_DIR', resp.content)

    def test_path_traversal_encoded_dotdot_rejected(self):
        # Django decodes the query string before the view sees it, so
        # request.query_params.get('doc') is byte-identical to the plain
        # '../../manage.py' case above by the time the whitelist lookup
        # runs. Kept deliberately anyway as documentation of that decoding
        # behaviour (a reader might otherwise assume URL-encoding bypasses
        # Django's own query parsing) — not claimed as an independent
        # regression guard.
        resp = self._get(self.boss, '?doc=..%2f..%2fmanage.py')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(b'BASE_DIR', resp.content)

    def test_path_traversal_absolute_path_rejected(self):
        resp = self._get(self.boss, '?doc=/etc/passwd')
        self.assertEqual(resp.status_code, 404)

    def test_slug_case_mismatch_rejected(self):
        resp = self._get(self.boss, '?doc=Shipment-Process-Boss')
        self.assertEqual(resp.status_code, 404)

    def test_real_unlisted_file_in_same_directory_rejected(self):
        """The sharpest traversal case: a real, existing file that sits in
        docs/how_works/ alongside the two whitelisted docs, but was never
        added to _PROCESS_DOCS. Under the whitelist this correctly 404s.
        Under a hypothetical path-joining implementation
        (Path(_PROCESS_DOCS_DIR) / f'{slug}.html') this would 200 with the
        real file's contents on any OS, unlike the dotdot/absolute-path
        cases above (which resolve to nonexistent paths either way) or the
        case-variant test (which only flips on a case-insensitive
        filesystem). See discrimination proof in the fix report.
        """
        resp = self._get(self.boss, '?doc=walkthrough')
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn('YGT Export — Interactive Walkthrough', resp.content.decode('utf-8'))

    # -- permission regression guard --------------------------------------

    def test_non_boss_non_director_gets_403(self):
        resp = self._get(self.export_mgr, '?doc=shipment-bpmn')
        self.assertEqual(resp.status_code, 403)

    # -- missing param ------------------------------------------------------

    def test_missing_doc_param_returns_404(self):
        resp = self._get(self.boss, '')
        self.assertEqual(resp.status_code, 404)
