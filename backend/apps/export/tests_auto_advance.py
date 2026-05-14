"""State machine v2 — auto-advance integration tests.

Covers the contract that filling a step's trigger field automatically fires
transition_to() to the next step. See plan §C/§E and AD-14.

Tested transitions:
  - draft → gumruk_girish (FIELD_EQUALS trigger: documents_status='in_progress')
  - gumruk_girish → gumruk_chykysh (customs_exit_at filled)
  - barysh_gumrugi → transshipment when has_peregruz=True (peregruz_date filled)
  - barysh_gumrugi → bardy when has_peregruz=False (arrived_at filled)
  - Re-entry guard prevents the inner save() inside transition_to() from
    cascading into a second auto-advance.

Run:
    python manage.py test apps.export.tests_auto_advance --keepdb
"""
from django.test import TestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, ShipmentStatusLog, TaskState


# State machine v2 — 12 active + 3 retired status types.
V2_STATUSES = [
    ('draft',           0,  'DRAFT'),
    ('gumruk_girish',   1,  'CUSTOMS'),
    ('gumruk_chykysh',  2,  'CUSTOMS'),
    ('yuklenme',        3,  'LOADING'),
    ('yola_chykdy',     4,  'TRANSIT'),
    ('serhet_gechdi',   5,  'BORDER'),
    ('dest_entry',      6,  'BORDER'),
    ('barysh_gumrugi',  7,  'BORDER'),
    ('transshipment',   8,  'SALES'),
    ('bardy',           9,  'SALES'),
    ('satylyar',       10,  'SALES'),
    ('satyldy',        11,  'SALES'),
    ('tamamlandy',     12,  'COMPLETE'),
]


def _ensure_statuses():
    for code, order, phase in V2_STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code, 'name_en': code, 'name_ru': code,
                'step_order': order, 'phase': phase,
            },
        )


def _seed_rules():
    SeedTaskRulesCommand().handle(reset=False)


def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True},
    )
    return season


class DraftAutoAdvanceTests(TestCase):
    """draft → gumruk_girish fires when documents_status='in_progress'."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        _seed_rules()
        cls.user = _make_user('test_doc', 'document_team')
        cls.season = _make_season()

    def _make_draft_with_destination(self) -> Shipment:
        """Create a draft with country/customer/import_firm/firm_splits filled
        so only the documents_status FIELD_EQUALS rule remains as a gate.
        """
        from apps.core.models import Country, Customer, ImportFirm, ExportFirm
        from apps.export.models import ShipmentFirmSplit

        country = Country.objects.create(name_tk='KZ', name_en='Kazakhstan', name_ru='KZ')
        customer = Customer.objects.create(name='Berik')
        import_firm = ImportFirm.objects.create(name_company='Test IF', country=country)
        export_firm = ExportFirm.objects.create(code='Y', name_tk='YGT', name_en='YGT')

        draft = ShipmentStatusType.objects.get(code='draft')
        shipment = Shipment.objects.create(
            cargo_code='0101001/26',
            date='2026-01-01',
            season=self.season,
            status=draft,
            country=country,
            customer=customer,
            import_firm=import_firm,
            created_by=self.user,
            updated_by=self.user,
        )
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=export_firm, weight_kg=10000,
        )
        # Re-save to retrigger task generation for draft step now that the
        # related rows exist. Tasks for set_destination/pick_export_firms
        # should auto-resolve on this save.
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'draft')
        # Also need to set is_gapy_satys explicitly so condition rules match.
        shipment.is_gapy_satys = False
        shipment.save()
        return shipment

    def test_field_equals_in_progress_fires_advance(self):
        shipment = self._make_draft_with_destination()
        # Set driver_id to satisfy the assign_driver task too.
        shipment.driver_id = 99
        shipment.documents_status = 'in_progress'
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'gumruk_girish',
            f'Expected auto-advance to gumruk_girish, got {shipment.status.code}',
        )
        # The auto-advance log row must be marked is_auto=True.
        last_log = (
            ShipmentStatusLog.objects.filter(shipment=shipment, status__code='gumruk_girish')
            .order_by('-changed_at').first()
        )
        self.assertIsNotNone(last_log)
        self.assertTrue(last_log.is_auto, 'Status log must be flagged is_auto=True')

    def test_field_equals_wrong_value_does_not_fire(self):
        shipment = self._make_draft_with_destination()
        shipment.driver_id = 99
        # Wrong value — must not fire.
        shipment.documents_status = 'delayed'
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'draft',
            'documents_status=delayed must not trigger auto-advance',
        )


class PeregruzForkTests(TestCase):
    """barysh_gumrugi auto-advance picks transshipment or bardy based on has_peregruz."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        _seed_rules()
        cls.user = _make_user('test_sr', 'sales_rep')
        cls.season = _make_season()

    def _make_at_status(self, code: str, has_peregruz: bool) -> Shipment:
        status = ShipmentStatusType.objects.get(code=code)
        shipment = Shipment.objects.create(
            cargo_code=f'TEST-{code[:4]}-{int(has_peregruz)}',
            date='2026-01-01',
            season=self.season,
            status=status,
            has_peregruz=has_peregruz,
            created_by=self.user,
            updated_by=self.user,
        )
        # Generate the step's tasks so the trigger logic has something to gate on.
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, code)
        return shipment

    def test_with_peregruz_advances_to_transshipment(self):
        from django.utils import timezone
        shipment = self._make_at_status('barysh_gumrugi', has_peregruz=True)
        shipment.peregruz_date = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'transshipment')

    def test_without_peregruz_advances_to_bardy(self):
        from django.utils import timezone
        shipment = self._make_at_status('barysh_gumrugi', has_peregruz=False)
        shipment.arrived_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'bardy')


class ReentryGuardTests(TestCase):
    """The transition_to() inner save() must not re-trigger auto-advance."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        _seed_rules()
        cls.user = _make_user('test_sr2', 'sales_rep')
        cls.season = _make_season()

    def test_single_step_only(self):
        """Even if the inner save() leaves the shipment in a state where the
        next step is also satisfied, auto-advance fires only ONCE per outer
        save (strict single-step per plan).
        """
        from django.utils import timezone

        gg = ShipmentStatusType.objects.get(code='gumruk_girish')
        shipment = Shipment.objects.create(
            cargo_code='REENTRY-1',
            date='2026-01-01',
            season=self.season,
            status=gg,
            has_peregruz=False,
            created_by=self.user,
            updated_by=self.user,
        )
        # Pre-fill loading_started_at and customs_exit_at simultaneously.
        # customs_exit_at fills gumruk_girish's trigger → advances to
        # gumruk_chykysh. The inner save() resolves gumruk_chykysh's task
        # (loading_started_at also present) but the re-entry guard short-
        # circuits the second auto-advance.
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'gumruk_girish')

        shipment.loading_started_at = timezone.now()
        shipment.customs_exit_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        # Must have advanced exactly once: gumruk_girish → gumruk_chykysh.
        self.assertEqual(shipment.status.code, 'gumruk_chykysh')


class StepWithoutAutoRulesStaysManualTests(TestCase):
    """A step with zero non-MANUAL_DONE rules is never auto-advanced."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        # Do NOT seed rules — this isolates the "no rules" case.
        cls.user = _make_user('test_mgr', 'export_manager')
        cls.season = _make_season()

    def test_no_rules_no_auto_advance(self):
        draft = ShipmentStatusType.objects.get(code='draft')
        shipment = Shipment.objects.create(
            cargo_code='NORULES-1',
            date='2026-01-01',
            season=self.season,
            status=draft,
            created_by=self.user,
            updated_by=self.user,
        )
        # Fill arbitrary fields — without rules there's nothing to resolve.
        shipment.documents_status = 'in_progress'
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'draft',
            'No TaskRules should mean no auto-advance, ever',
        )
