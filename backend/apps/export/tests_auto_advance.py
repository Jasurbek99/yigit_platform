"""State machine v2 — auto-advance integration tests.

Covers the contract that filling a step's trigger field automatically fires
transition_to() to the next step. See plan §C/§E and AD-14.

Tested transitions:
  - draft → gumruk_girish (FIELD_EQUALS trigger: documents_status='ready')
  - gumruk_girish → gumruk_chykysh (customs_exit_at filled)
  - barysh_gumrugi → transshipment when has_peregruz=True (peregruz_date filled)
  - barysh_gumrugi → bardy when has_peregruz=False (arrived_at filled)
  - Cascade: when multiple downstream triggers are already filled at save
    time, auto_advance walks the shipment forward through every satisfied
    step (capped at MAX_CHAIN=13).

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
        from apps.core.models import Country, Customer, GreenhouseBlock, ImportFirm, ExportFirm
        from apps.export.models import ShipmentBlockSource, ShipmentFirmSplit

        country = Country.objects.create(name_tk='KZ', name_en='Kazakhstan', name_ru='KZ')
        customer = Customer.objects.create(name='Berik')
        import_firm = ImportFirm.objects.create(name_company='Test IF', country=country)
        export_firm = ExportFirm.objects.create(code='Y', name_tk='YGT', name_en='YGT')
        block = GreenhouseBlock.objects.create(code='AA-1', name='AA-1')

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
        # transition_to() draft-leave guard requires block_sources (supply
        # half of the two-row flow). The auto-advance cascade goes through
        # transition_to(), so without this row the test would 400 at the gate.
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=block, weight_kg=10000,
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

    def test_field_equals_ready_fires_advance(self):
        shipment = self._make_draft_with_destination()
        # Satisfy the assign_driver task (ALL_FIELDS_FILLED on
        # driver_name + driver_phone + truck_plate, condition is_gapy_satys=False).
        shipment.driver_name = 'Test Driver'
        shipment.driver_phone = '+99363391774'
        shipment.truck_plate = 'AB1234'
        shipment.documents_status = 'ready'
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

    def test_field_equals_intermediate_value_does_not_fire(self):
        shipment = self._make_draft_with_destination()
        shipment.driver_name = 'Test Driver'
        shipment.driver_phone = '+99363391774'
        shipment.truck_plate = 'AB1234'
        # documents_status='in_progress' is now an intermediate state, not the
        # trigger value. Operators walk pending -> in_progress -> ready; only
        # 'ready' fires the advance.
        shipment.documents_status = 'in_progress'
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(
            shipment.status.code, 'draft',
            'documents_status=in_progress is intermediate; only "ready" advances',
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


class CascadeTests(TestCase):
    """Auto-advance walks forward through every pre-satisfied step."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        _seed_rules()
        cls.user = _make_user('test_sr2', 'sales_rep')
        cls.season = _make_season()

    def test_cascades_when_multiple_triggers_satisfied(self):
        """When several downstream triggers are already filled at save time,
        auto-advance walks the shipment forward step-by-step until it hits
        an unsatisfied step. Each step writes its own audit log row.
        """
        from django.utils import timezone

        gg = ShipmentStatusType.objects.get(code='gumruk_girish')
        shipment = Shipment.objects.create(
            cargo_code='CASCADE-1',
            date='2026-01-01',
            season=self.season,
            status=gg,
            has_peregruz=False,
            created_by=self.user,
            updated_by=self.user,
        )
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'gumruk_girish')

        now = timezone.now()
        # Pre-fill the entire trigger chain through yola_chykdy:
        # gumruk_girish    → customs_exit_at
        # gumruk_chykysh   → loading_started_at
        # yuklenme         → departed_at (+ block_sources/variety/weights gate other yuklenme tasks
        #                                   that are NOT triggers; they're operational so a save
        #                                   that fills only departed_at still won't satisfy yuklenme's
        #                                   ALL_FIELDS_FILLED gates — so cascade stops at yuklenme.)
        shipment.customs_exit_at = now
        shipment.loading_started_at = now
        shipment.departed_at = now
        shipment.save()

        shipment.refresh_from_db()
        # Cascade walks gumruk_girish → gumruk_chykysh → yuklenme. It stops at
        # yuklenme because the operational tasks (fill_loading_data,
        # quality_inspection) require fields we did not fill.
        self.assertEqual(shipment.status.code, 'yuklenme')
        # Each transition is audited individually.
        log_codes = list(
            ShipmentStatusLog.objects.filter(shipment=shipment)
            .order_by('changed_at')
            .values_list('status__code', flat=True)
        )
        self.assertEqual(log_codes, ['gumruk_chykysh', 'yuklenme'])
        # Every cascaded transition is flagged is_auto=True.
        self.assertTrue(all(
            log.is_auto for log in ShipmentStatusLog.objects.filter(shipment=shipment)
        ))


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
