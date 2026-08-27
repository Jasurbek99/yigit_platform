"""Media urls must be ROOT-RELATIVE, never absolute.

Regression guard for the 2026-08-27 bug: uploaded director signatures and
company seals reported success but rendered as broken images.

DRF's stock ``FileField`` returns ``request.build_absolute_uri(value.url)``.
That url is built from the ``Host`` header Django received, and NEITHER proxy in
front of this app sets it to the browser's real origin:

  * production nginx forwards ``Host $host``, which DROPS the port, so a browser
    on ``:8080`` was handed ``http://10.10.11.25/media/...`` → port 80 → 404.
  * the Vite dev proxy sets ``changeOrigin: true``, so the api answered
    ``http://127.0.0.1:8000/media/...`` — resolvable only ON the dev machine.

Every assertion below therefore serialises WITH a request in context: that is
the exact condition under which the old field produced an absolute url, so a
test without it would pass against the broken code.

Run with:
    python manage.py test apps.core.tests_media_urls --verbosity=2
"""
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.core.models import ExportFirm, ImportFirm
from apps.export.views_admin import ExportFirmSerializer, ImportFirmSerializer


def _ctx():
    """A request context whose Host is deliberately NOT the browser's origin."""
    return {'request': APIRequestFactory().get('/', HTTP_HOST='10.10.11.25')}


class MediaUrlsAreRelativeTests(TestCase):

    def _assert_relative(self, url: str, expected_suffix: str) -> None:
        self.assertIsNotNone(url)
        self.assertTrue(url.startswith('/media/'), f'not root-relative: {url!r}')
        self.assertNotIn('://', url, f'absolute url leaked: {url!r}')
        self.assertTrue(url.endswith(expected_suffix), url)

    def test_export_firm_signature_and_seal_are_relative(self):
        firm = ExportFirm.objects.create(
            code='TST', name_short='T', name_tk='T', name_en='T', name_ru='T',
            director_signature='export_firms/signatures/sig.png',
            director_seal='export_firms/seals/seal.png',
        )
        data = ExportFirmSerializer(firm, context=_ctx()).data
        self._assert_relative(data['director_signature'], 'signatures/sig.png')
        self._assert_relative(data['director_seal'], 'seals/seal.png')

    def test_import_firm_signature_and_seal_are_relative(self):
        firm = ImportFirm.objects.create(
            code='IMP', name_company='I', name_short='I',
            director_signature='import_firms/signatures/sig.png',
            director_seal='import_firms/seals/seal.png',
        )
        data = ImportFirmSerializer(firm, context=_ctx()).data
        self._assert_relative(data['director_signature'], 'signatures/sig.png')
        self._assert_relative(data['director_seal'], 'seals/seal.png')

    def test_empty_file_serialises_to_none(self):
        """A firm with no upload must stay None, not '' — the frontend renders
        the <img> on truthiness (`firm.director_seal && <img .../>`)."""
        firm = ExportFirm.objects.create(
            code='NON', name_short='N', name_tk='N', name_en='N', name_ru='N',
        )
        data = ExportFirmSerializer(firm, context=_ctx()).data
        self.assertIsNone(data['director_signature'])
        self.assertIsNone(data['director_seal'])

    def test_upload_still_writes_the_file(self):
        """Only `to_representation` was overridden. If `to_internal_value` were
        touched too, the admin PATCH that uploads a seal would break silently —
        the same serializer handles both directions."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        firm = ExportFirm.objects.create(
            code='UPL', name_short='U', name_tk='U', name_en='U', name_ru='U',
        )
        upload = SimpleUploadedFile('seal.png', b'\x89PNG\r\n\x1a\n', content_type='image/png')
        serializer = ExportFirmSerializer(
            firm, data={'director_seal': upload}, partial=True, context=_ctx(),
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        saved = serializer.save()
        try:
            self.assertIn('export_firms/seals/seal', saved.director_seal.name)
            self._assert_relative(
                ExportFirmSerializer(saved, context=_ctx()).data['director_seal'], '.png',
            )
        finally:
            saved.director_seal.delete(save=False)
