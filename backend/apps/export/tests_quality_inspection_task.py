"""The quality-inspection task fires when "Ýükleme başlady" is filled.

The user's requirement, stated literally: *"add them task to fill it, trigger
is filling line Ýükleme başlady"*. That line is R19, ``loading_started_at``.
It is not itself a task trigger for `yuklenme` — it resolves
``tasks.trigger_loading_start`` on ``gumruk_chykysh``, which auto-advances the
shipment into ``yuklenme``, where ``tasks.quality_inspection`` is generated.
Three moving parts, so the test drives the real one (fill the field, save) and
asserts the end state rather than calling the generator directly.

The second test is the one that matters operationally. This rule was disabled
on 2026-06-06 (commit 84f1a98) because, as ALL_FIELDS_FILLED, its four quality
flags gated ``yuklenme -> yola_chykdy`` and froze real trucks. It is MANUAL_DONE
now, and ``is_step_trigger_satisfied`` excludes MANUAL_DONE — so an untouched
quality task must NOT hold the truck. If someone ever flips this rule back to a
field-based completion, that test fails and says why.
"""
from django.test import TestCase
from django.utils import timezone
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import (
    QualityDocument, Shipment, Task, TaskCompletionRule, TaskState,
)

V2_STATUSES = [
    ('draft', 0, 'DRAFT'),
    ('gumruk_girish', 1, 'CUSTOMS'),
    ('gumruk_chykysh', 2, 'CUSTOMS'),
    ('yuklenme', 3, 'LOADING'),
    ('yola_chykdy', 4, 'TRANSIT'),
]

JPEG_MAGIC = bytes([0xFF, 0xD8, 0xFF])

QUALITY_FIELDS = [
    'quality.azyk_maglumatnama',
    'quality.suriji_gozukdiriji',
    'quality.hil_sertifikaty',
    'quality.kalibrowka_analiz',
    'transit_days',
    'transport_temp_c',
    'shelf_life_days',
]


class QualityInspectionTaskTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in V2_STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='qi_loader', password='pw', role='loading_dept_head',
        )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-06-30',
                'is_active': True,
            },
        )

    def _shipment_at_customs_exit(self, code: str) -> Shipment:
        """A shipment sitting at gumruk_chykysh, one field short of loading."""
        status = ShipmentStatusType.objects.get(code='gumruk_chykysh')
        shipment = Shipment.objects.create(
            shipment_code=code,
            date='2026-01-01',
            season=self.season,
            status=status,
            created_by=self.user,
            updated_by=self.user,
        )
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'gumruk_chykysh')
        return shipment

    def _fill_loading_start(self, shipment: Shipment) -> Shipment:
        """Fill R19 'Ýükleme başlady' — the user's stated trigger."""
        shipment.loading_started_at = timezone.now()
        shipment.updated_by = self.user
        shipment.save()
        shipment.refresh_from_db()
        return shipment

    def test_filling_loading_started_at_advances_to_yuklenme(self):
        shipment = self._fill_loading_start(self._shipment_at_customs_exit('QI-1'))
        self.assertEqual(shipment.status.code, 'yuklenme')

    def test_that_advance_creates_a_task_for_the_quality_inspector(self):
        shipment = self._fill_loading_start(self._shipment_at_customs_exit('QI-2'))
        task = Task.objects.get(
            shipment=shipment, title_key='tasks.quality_inspection',
        )
        self.assertEqual(task.assignee_role, 'quality_inspector')
        self.assertEqual(task.state, TaskState.OPEN)

    def test_the_task_lists_all_seven_fields_to_fill(self):
        shipment = self._fill_loading_start(self._shipment_at_customs_exit('QI-3'))
        task = Task.objects.get(
            shipment=shipment, title_key='tasks.quality_inspection',
        )
        fields = [f.strip() for f in task.target_fields.split(',') if f.strip()]
        self.assertEqual(fields, QUALITY_FIELDS)

    def test_the_task_is_manual_done_so_it_can_never_freeze_a_truck(self):
        """The whole reason the June 2026 version of this rule was disabled."""
        shipment = self._fill_loading_start(self._shipment_at_customs_exit('QI-4'))
        task = Task.objects.get(
            shipment=shipment, title_key='tasks.quality_inspection',
        )
        self.assertEqual(task.completion_rule, TaskCompletionRule.MANUAL_DONE)

    def test_an_untouched_quality_task_does_not_block_departure(self):
        """End-to-end proof of the above: fill only the departure trigger,
        leave every quality field empty, and the truck still leaves.

        `tasks.fill_loading_data` is satisfied here so that the quality task is
        the only thing that could hold the shipment at yuklenme.
        """
        from apps.core.models import GreenhouseBlock, TomatoVariety
        from apps.export.models import ShipmentBlockSource

        shipment = self._fill_loading_start(self._shipment_at_customs_exit('QI-5'))
        self.assertEqual(shipment.status.code, 'yuklenme')

        block = GreenhouseBlock.objects.create(code='QI-B', name='QI-B')
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=block, weight_kg=10000,
        )
        shipment.variety = TomatoVariety.objects.create(name='QI Pink')
        shipment.weight_net = 18500
        shipment.departed_at = timezone.now()
        shipment.updated_by = self.user
        shipment.save()
        shipment.refresh_from_db()

        quality_task = Task.objects.get(
            shipment=shipment, title_key='tasks.quality_inspection',
        )
        self.assertEqual(quality_task.state, TaskState.OPEN, 'quality task was not touched')
        self.assertEqual(
            shipment.status.code, 'yola_chykdy',
            'an open MANUAL_DONE quality task must not gate the departure',
        )


class QualityCertificateUploadTests(TestCase):
    """Uploading certificate scans, and the derived flags they drive.

    Replaces the tests for `PATCH /shipments/{id}/quality/`, removed 2026-09-22
    when the four checkboxes became file uploads. The permission contract is
    unchanged and still matrix-gated on the `quality_document` resource — what
    changed is that there is no longer any way to tick a flag without a file.
    """

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        call_command('seed_permissions')

        for code, order, phase in V2_STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        cls.author = User.objects.create_user(
            username='qc_author', password='pw', role='admin',
        )

    _seq = 0

    def setUp(self):
        # get_resource_perm memoises the matrix; a value cached by another test
        # (or a previous --keepdb run) would decide these 403s instead of the
        # rows seeded above. Same reason TestEveryRoleCanEditItsOwnSheetRow
        # clears it.
        cache.clear()
        self._n = 0
        # `code` is a short column — a per-test counter keeps it unique and short.
        QualityCertificateUploadTests._seq += 1
        self.seq = QualityCertificateUploadTests._seq
        self.shipment = Shipment.objects.create(
            shipment_code=f'QC-{self.seq:04d}/26',
            date='2026-01-01',
            season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'),
            created_by=self.author,
            updated_by=self.author,
        )
        self.url = (
            f'/api/v1/export/shipments/{self.shipment.id}/quality-certificates/'
        )

    @staticmethod
    def _jpeg(name: str = 'cert.jpg') -> SimpleUploadedFile:
        """A file whose magic bytes really are a JPEG — the validator reads the
        header, not the extension."""
        return SimpleUploadedFile(name, JPEG_MAGIC + b'0' * 64, 'image/jpeg')

    def _client(self, role: str) -> APIClient:
        self._n += 1
        user = User.objects.create_user(
            username=f'qc_{role}_{self.seq}_{self._n}',
            password='pw', role=role,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _upload(self, role: str, doc_type: str = 'azyk_maglumatnama', file=None):
        return self._client(role).post(
            self.url,
            {'doc_type': doc_type, 'files': file or self._jpeg()},
            format='multipart',
        )

    # ── permissions ───────────────────────────────────────────────────────────

    def test_quality_inspector_may_upload(self):
        self.assertEqual(self._upload('quality_inspector').status_code, 201)

    def test_roles_that_could_write_before_still_can(self):
        for role in ('admin', 'director', 'export_manager', 'document_team'):
            with self.subTest(role=role):
                self.assertEqual(self._upload(role).status_code, 201)

    def test_boss_may_write_the_surface_his_matrix_says_he_owns(self):
        """Latent bug the old hardcoded tuple was hiding — see roles.py."""
        self.assertEqual(self._upload('boss').status_code, 201)

    def test_a_role_without_the_resource_is_refused(self):
        for role in ('transport', 'sales_rep'):
            with self.subTest(role=role):
                self.assertEqual(self._upload(role).status_code, 403)

    # ── derived flags ─────────────────────────────────────────────────────────

    def test_uploading_a_scan_sets_that_certificate_flag(self):
        self._upload('quality_inspector', 'hil_sertifikaty')
        quality = QualityDocument.objects.get(shipment=self.shipment)
        self.assertTrue(quality.hil_sertifikaty)

    def test_only_the_uploaded_type_is_flagged(self):
        self._upload('quality_inspector', 'hil_sertifikaty')
        quality = QualityDocument.objects.get(shipment=self.shipment)
        self.assertFalse(quality.azyk_maglumatnama)
        self.assertFalse(quality.suriji_gozukdiriji)
        self.assertFalse(quality.kalibrowka_analiz)

    def test_deleting_the_last_scan_clears_the_flag(self):
        """The failure this guards: a flag left True after its evidence is gone
        is a certificate the dashboard counts and the truck does not carry."""
        response = self._upload('quality_inspector', 'kalibrowka_analiz')
        certificate_id = response.json()[0]['id']
        quality = QualityDocument.objects.get(shipment=self.shipment)
        self.assertTrue(quality.kalibrowka_analiz)

        deleted = self._client('quality_inspector').post(f'{self.url}{certificate_id}/delete/')
        self.assertEqual(deleted.status_code, 200)
        quality.refresh_from_db()
        self.assertFalse(quality.kalibrowka_analiz)

    def test_deleting_one_of_two_scans_keeps_the_flag(self):
        first = self._upload('quality_inspector', 'azyk_maglumatnama').json()[0]['id']
        self._upload('quality_inspector', 'azyk_maglumatnama')

        removed = self._client('quality_inspector').post(f'{self.url}{first}/delete/')
        self.assertEqual(removed.status_code, 200)
        quality = QualityDocument.objects.get(shipment=self.shipment)
        self.assertTrue(quality.azyk_maglumatnama, 'one scan remains')

    def test_the_old_boolean_endpoint_is_gone(self):
        """Nothing may write a flag without a file."""
        response = self._client('quality_inspector').patch(
            f'/api/v1/export/shipments/{self.shipment.id}/quality/',
            data={'hil_sertifikaty': True},
            format='json',
        )
        self.assertEqual(response.status_code, 404)

    # ── validation ────────────────────────────────────────────────────────────

    def test_a_non_image_is_rejected_on_its_magic_bytes(self):
        bad = SimpleUploadedFile('cert.jpg', b'not really a jpeg', 'image/jpeg')
        response = self._upload('quality_inspector', file=bad)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            QualityDocument.objects.filter(
                shipment=self.shipment, azyk_maglumatnama=True,
            ).exists(),
            'a rejected upload must not flag the certificate',
        )

    def test_an_unknown_doc_type_is_rejected(self):
        response = self._upload('quality_inspector', doc_type='not_a_certificate')
        self.assertEqual(response.status_code, 400)


class QualityTaskReachesMyTasksTests(TestCase):
    """The task must actually land on the inspector's My Tasks board.

    Everything else in this module asserts on Task rows in the database. That
    proves the rule fires, not that the person it is for can see it — and
    `GET /api/v1/me/tasks/` scopes by role through `task_roles_for()`, a map
    `quality_inspector` has no entry in. This is the link that makes the
    feature visible rather than merely correct.
    """

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in V2_STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code,
                defaults={
                    'name_tk': code, 'name_en': code, 'name_ru': code,
                    'step_order': order, 'phase': phase,
                },
            )
        SeedTaskRulesCommand().handle(reset=False)
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-06-30',
                'is_active': True,
            },
        )
        loader = User.objects.create_user(
            username='mt_loader', password='pw', role='loading_dept_head',
        )
        cls.inspector = User.objects.create_user(
            username='mt_inspector', password='pw', role='quality_inspector',
        )
        shipment = Shipment.objects.create(
            shipment_code='MT-1',
            date='2026-01-01',
            season=cls.season,
            status=ShipmentStatusType.objects.get(code='gumruk_chykysh'),
            created_by=loader,
            updated_by=loader,
        )
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'gumruk_chykysh')
        shipment.loading_started_at = timezone.now()
        shipment.updated_by = loader
        shipment.save()
        cls.shipment = shipment

    def _my_tasks(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.get('/api/v1/me/tasks/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        return data['results'] if isinstance(data, dict) and 'results' in data else data

    def test_the_inspector_sees_the_quality_task_on_my_tasks(self):
        titles = [t['title_key'] for t in self._my_tasks(self.inspector)]
        self.assertIn('tasks.quality_inspection', titles)

    def test_another_operational_role_does_not_see_it(self):
        """Scoped to the inspector, not broadcast to everyone on the step."""
        transport = User.objects.create_user(
            username='mt_transport', password='pw', role='transport',
        )
        titles = [t['title_key'] for t in self._my_tasks(transport)]
        self.assertNotIn('tasks.quality_inspection', titles)
