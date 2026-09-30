"""Task chain for PREP/DOCS (spec 2026-09-30-prep-docs-tasks-design)."""
from django.db import connection
from django.test import TestCase

from apps.export.models import ShipmentDocumentDownload, TaskCompletionRule, TaskRule


class ChainModelTests(TestCase):
    def test_new_rule_fields_and_defaults(self):
        rule = TaskRule.objects.create(step='draft', title_key='tasks.x', assignee_role='export_manager')
        self.assertEqual((rule.depends_on, rule.gates_step, rule.effective_from), ('', True, None))
        self.assertEqual(TaskCompletionRule.CONFIRM, 'confirm')

    def test_old_code_can_insert_a_rule_without_the_new_columns(self):
        # Beta runs old code on this database: its INSERT omits the new columns.
        with connection.cursor() as c:
            c.execute(
                "INSERT INTO export_task_rule (step, title_key, assignee_role, target_fields, "
                "completion_rule, target_value, deadline_rule, condition_field, condition_value, "
                "is_active, created_at) VALUES ('draft', 'tasks.legacy', 'export_manager', '', "
                "'manual_done', '', '', '', '', 1, SYSDATETIME())"
            )
        rule = TaskRule.objects.get(title_key='tasks.legacy')
        self.assertEqual((rule.depends_on, rule.gates_step), ('', True))

    def test_download_row(self):
        self.assertEqual(ShipmentDocumentDownload._meta.get_field('doc_key').max_length, 24)


# ── Engine: dependencies, deferred creation, E3, save ordering (Task 2) ──────
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, ShipmentStatusLog, TaskState
from apps.export.services.task_chain import has_pending_dependents, step_entered_at
from apps.export.services.task_rules import generate_tasks_for_status

STATUSES = [('draft', 0, 'DRAFT'), ('gumruk_girish', 1, 'CUSTOMS'), ('gumruk_chykysh', 2, 'CUSTOMS')]


def _rule(step, title, **kw):
    base = dict(step=step, title_key=title, assignee_role='document_team',
                completion_rule=TaskCompletionRule.CONFIRM)
    base.update(kw)
    return TaskRule.objects.create(**base)


class ChainFixture(TestCase):
    """Fixture + helpers only — no test_ methods, so subclasses in other
    modules don't re-run anything."""

    @classmethod
    def setUpTestData(cls):
        for code, order, phase in STATUSES:
            ShipmentStatusType.objects.get_or_create(
                code=code, defaults={'name_tk': code, 'name_en': code, 'name_ru': code,
                                     'step_order': order, 'phase': phase})
        cls.user = User.objects.create_user(username='tc_dt', password='pw', role='document_team')
        cls.season, _ = Season.objects.get_or_create(
            name='2025-2026', defaults={'start_date': '2025-09-01', 'end_date': '2026-06-30', 'is_active': True})

    def _at(self, code='gumruk_girish', **extra):
        return Shipment.objects.create(
            shipment_code=f'TC-{Shipment.objects.count() + 1}', date='2026-01-01',
            season=self.season, status=ShipmentStatusType.objects.get(code=code),
            created_by=self.user, updated_by=self.user, **extra)

    def _press(self, shipment, title):
        """What POST /tasks/{id}/complete/ does for a confirm task (Task 3 wires the view)."""
        from apps.export.services.task_chain import after_task_done
        task = shipment.tasks.get(title_key=title)
        task.state = TaskState.DONE
        task.completed_at = timezone.now()
        task.save(update_fields=['state', 'completed_at'])
        after_task_done(shipment, self.user, [task])
        shipment.refresh_from_db()


class ChainEngineTests(ChainFixture):
    def test_dependent_appears_only_when_prerequisites_done(self):
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.b')
        _rule('gumruk_girish', 'tasks.c', depends_on='tasks.a,tasks.b')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertFalse(s.tasks.filter(title_key='tasks.c').exists())
        self._press(s, 'tasks.a')
        self.assertFalse(s.tasks.filter(title_key='tasks.c').exists())
        self._press(s, 'tasks.b')
        self.assertTrue(s.tasks.filter(title_key='tasks.c', state=TaskState.OPEN).exists())

    def test_earlier_step_rule_without_a_task_counts_as_done(self):
        # The deploy-crossing shipment: no task for the draft-step prerequisite.
        _rule('draft', 'tasks.choose_truck', completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
              target_fields='truck_head_id')
        _rule('gumruk_girish', 'tasks.after_truck', depends_on='tasks.choose_truck')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(s.tasks.filter(title_key='tasks.after_truck').exists())

    def test_variant_that_does_not_apply_is_ignored(self):
        _rule('gumruk_girish', 'tasks.gapy_only', condition_field='is_gapy_satys', condition_value='True')
        _rule('gumruk_girish', 'tasks.x', depends_on='tasks.gapy_only')
        s = self._at(is_gapy_satys=False)
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(s.tasks.filter(title_key='tasks.x').exists())

    def test_step_does_not_advance_while_dependents_are_pending(self):
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.c', depends_on='tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertTrue(has_pending_dependents(s))
        self._press(s, 'tasks.a')             # a done → c spawns; c open → no advance
        self.assertEqual(s.status.code, 'gumruk_girish')
        self._press(s, 'tasks.c')
        self.assertEqual(s.status.code, 'gumruk_chykysh')

    def test_rule_not_yet_effective_for_a_shipment_already_in_the_step(self):
        s = self._at()
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user)
        _rule('gumruk_girish', 'tasks.new', effective_from=timezone.now() + timezone.timedelta(seconds=1))
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertFalse(s.tasks.filter(title_key='tasks.new').exists())
        self.assertFalse(has_pending_dependents(s))

    def test_step_entered_at_is_the_status_change_not_a_packing_move_log(self):
        s = self._at()
        self.assertEqual(step_entered_at(s), s.created_at)
        # join / swap / unjoin write a same-status log row; the step did not change.
        ShipmentStatusLog.objects.create(shipment=s, status=s.status, changed_by=self.user,
                                         comment='Packing swapped with TC-9')
        self.assertEqual(step_entered_at(s), s.created_at)
        Shipment.objects.filter(pk=s.pk).update(status_changed_at=timezone.now())
        s.refresh_from_db()
        self.assertEqual(step_entered_at(s), s.status_changed_at)

    def test_non_gating_field_task_does_not_hold_the_step(self):
        _rule('gumruk_girish', 'tasks.join', completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
              target_fields='block_sources', gates_step=False)
        _rule('gumruk_girish', 'tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.a')
        self.assertEqual(s.status.code, 'gumruk_chykysh')
        self.assertEqual(s.tasks.get(title_key='tasks.join').state, TaskState.OPEN)

    def test_has_pending_dependents_ignores_a_stale_prefetched_tasks_cache(self):
        """Review A5: shipment.tasks.all() can read a stale prefetch cache
        populated before a dependent task was created — Task.objects.filter
        must be used instead."""
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.c', depends_on='tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')

        stale = Shipment.objects.prefetch_related('tasks').get(pk=s.pk)
        list(stale.tasks.all())            # cache populated while only tasks.a exists

        self._press(s, 'tasks.a')          # closes a on a fresh instance; spawns c for real

        self.assertFalse(
            has_pending_dependents(stale),
            'tasks.c already exists — a stale tasks cache must not report it as still pending',
        )

    def test_pending_non_gating_dependent_never_holds_the_step(self):
        _rule('gumruk_girish', 'tasks.a')
        _rule('gumruk_girish', 'tasks.b', depends_on='tasks.never', completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
              target_fields='block_sources', gates_step=False)
        _rule('gumruk_girish', 'tasks.never', completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
              target_fields='block_sources', gates_step=False)
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self.assertFalse(s.tasks.filter(title_key='tasks.b').exists())
        self._press(s, 'tasks.a')
        self.assertEqual(s.status.code, 'gumruk_chykysh')


# ── confirm buttons + side effects on close (Task 3) ─────────────────────────
from rest_framework.test import APIClient

from apps.core.models import ShipmentOptionType


class ChainEffectsTests(ChainFixture):
    def test_complete_accepts_confirm_and_advances(self):
        _rule('gumruk_girish', 'tasks.a')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        task = s.tasks.get(title_key='tasks.a')
        client = APIClient()
        client.force_authenticate(self.user)
        resp = client.post(f'/api/v1/export/tasks/{task.id}/complete/')
        self.assertEqual(resp.status_code, 200, resp.content)
        s.refresh_from_db()
        self.assertEqual(s.status.code, 'gumruk_chykysh')
        self.assertEqual(s.tasks.get(pk=task.pk).completed_by, self.user)

    def test_prepare_transport_docs_sets_documents_in_progress(self):
        _rule('gumruk_girish', 'tasks.prepare_transport_docs')
        _rule('gumruk_girish', 'tasks.hold')                       # keeps the step
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.prepare_transport_docs')
        self.assertEqual(s.documents_status, 'in_progress')

    def test_docs_from_customs_sets_the_gumrukden_geldi_option(self):
        ShipmentOptionType.objects.get_or_create(
            category='documents_status', code='Gümrükden geldi',
            defaults={'label_tk': 'Gümrükden geldi', 'is_active': True})
        _rule('gumruk_chykysh', 'tasks.docs_from_customs', completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED,
              target_fields='customs_exit_at')
        s = self._at('gumruk_chykysh')
        generate_tasks_for_status(s, 'gumruk_chykysh')
        s.customs_exit_at = timezone.now()
        s.save()
        s.refresh_from_db()
        self.assertEqual(s.documents_status, 'Gümrükden geldi')

    def test_prepare_transport_docs_effect_is_audited(self):
        """Review A3: the R6 documents_status write from apply_task_done_effects
        is a QuerySet.update() — it needs its own AuditLog row, same as
        rollback.py's re-gate writes."""
        from apps.export.models import AuditLog

        _rule('gumruk_girish', 'tasks.prepare_transport_docs')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.prepare_transport_docs')
        row = AuditLog.objects.get(object_id=s.pk, field_name='documents_status')
        self.assertEqual((row.old_value, row.new_value, row.user_id), ('', 'in_progress', self.user.pk))

    def test_manual_edit_after_the_effect_is_kept(self):
        _rule('gumruk_girish', 'tasks.prepare_transport_docs')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        self._press(s, 'tasks.prepare_transport_docs')
        Shipment.objects.filter(pk=s.pk).update(documents_status='ready')
        s.refresh_from_db()
        s.save()
        s.refresh_from_db()
        self.assertEqual(s.documents_status, 'ready')


# ── Other write paths: join / swap, advances, condition flips (Task 6) ───────
from decimal import Decimal

from apps.core.models import Country
from apps.export.services.task_rules import reconcile_shipment_tasks


class ChainWritePathTests(ChainFixture):
    def _draft_with_destination(self, **extra):
        country, _ = Country.objects.get_or_create(
            code='TC', defaults={'name_tk': 'Tc', 'name_en': 'Tc', 'name_ru': 'Tc'})
        return self._at('draft', country=country, **extra)

    def test_join_closes_join_supply_and_never_moves_the_truck(self):
        from django.core.management import call_command
        from apps.core.models import GreenhouseBlock
        from apps.export.models import ShipmentBlockSource

        call_command('seed_permissions')
        _rule('draft', 'tasks.join_supply', assignee_role='export_manager',
              completion_rule=TaskCompletionRule.ANY_FIELD_FILLED, target_fields='block_sources', gates_step=False)
        _rule('draft', 'tasks.pick_export_firms', completion_rule=TaskCompletionRule.ANY_FIELD_FILLED,
              target_fields='firm_splits')
        from apps.core.models import Customer
        target = self._draft_with_destination(customer=Customer.objects.get_or_create(name='TC customer')[0])
        generate_tasks_for_status(target, 'draft')
        source = self._at('draft')
        block, _ = GreenhouseBlock.objects.get_or_create(code='TCB')
        ShipmentBlockSource.objects.create(shipment=source, block=block, weight_kg=Decimal('12500'))
        manager = User.objects.create_user(username='tc_em', password='pw', role='export_manager')
        client = APIClient()
        client.force_authenticate(manager)
        resp = client.post(f'/api/v1/export/shipments/{target.pk}/join/', {'source_id': source.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content[:300])
        target.refresh_from_db()
        self.assertEqual(target.tasks.get(title_key='tasks.join_supply').state, TaskState.DONE)
        self.assertEqual(target.status.code, 'draft')

    def test_advance_create_closes_give_advance(self):
        from apps.export.models import FinansistAdvance
        _rule('gumruk_girish', 'tasks.give_advance', assignee_role='finansist',
              completion_rule=TaskCompletionRule.ANY_FIELD_FILLED, target_fields='advance_links')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        fin = User.objects.create_user(username='tc_fin', password='pw', role='finansist', is_superuser=True)
        client = APIClient()
        client.force_authenticate(fin)
        resp = client.post('/api/v1/export/advances/', {
            'advance_date': '2026-01-15', 'total_amount': '1000', 'currency': 'USD', 'shipment_ids': [s.pk],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content[:300])
        self.assertEqual(s.tasks.get(title_key='tasks.give_advance').state, TaskState.DONE)

        # …and the same through link-shipment on another truck.
        s2 = self._at()
        generate_tasks_for_status(s2, 'gumruk_girish')
        advance = FinansistAdvance.objects.get()
        resp = client.post(f'/api/v1/export/advances/{advance.pk}/link-shipment/', {'shipment_id': s2.pk},
                           format='json')
        self.assertEqual(resp.status_code, 200, resp.content[:300])
        self.assertEqual(s2.tasks.get(title_key='tasks.give_advance').state, TaskState.DONE)

    def test_destination_restored_after_clearing_spawns_the_dependents(self):
        from apps.core.models import Customer, ImportFirm
        _rule('draft', 'tasks.set_destination', assignee_role='export_manager',
              completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED, target_fields='country,customer,import_firm')
        _rule('draft', 'tasks.pick_export_firms', depends_on='tasks.set_destination',
              completion_rule=TaskCompletionRule.ANY_FIELD_FILLED, target_fields='firm_splits')
        s = self._draft_with_destination()                 # country only: 5b stays open
        generate_tasks_for_status(s, 'draft')
        country_id = s.country_id
        Shipment.objects.filter(pk=s.pk).update(country=None)   # cleared → a packing part
        s.refresh_from_db()
        reconcile_shipment_tasks(s, changed_fields=['country'])
        self.assertEqual(s.tasks.get(title_key='tasks.set_destination').state, TaskState.CANCELLED)

        # One PATCH puts all three back: 5b is reopened and closes at once.
        Shipment.objects.filter(pk=s.pk).update(
            country_id=country_id, customer=Customer.objects.get_or_create(name='TC back')[0],
            import_firm=ImportFirm.objects.get_or_create(code='TCIMP', defaults={'name_company': 'TC'})[0])
        s.refresh_from_db()
        reconcile_shipment_tasks(s, changed_fields=['country', 'customer', 'import_firm'])
        self.assertEqual(s.tasks.get(title_key='tasks.set_destination').state, TaskState.DONE)
        self.assertEqual(s.tasks.get(title_key='tasks.pick_export_firms').state, TaskState.OPEN)

    def test_gapy_flip_before_set_destination_creates_no_transport_task(self):
        _rule('draft', 'tasks.set_destination', assignee_role='export_manager',
              completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED, target_fields='country,customer,import_firm')
        _rule('draft', 'tasks.choose_truck', assignee_role='export_manager', depends_on='tasks.set_destination',
              completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED, target_fields='truck_head_id',
              condition_field='is_gapy_satys', condition_value='False')
        _rule('draft', 'tasks.assign_driver', depends_on='tasks.set_destination',
              completion_rule=TaskCompletionRule.ALL_FIELDS_FILLED, target_fields='driver_name',
              condition_field='is_gapy_satys', condition_value='True')
        s = self._draft_with_destination()
        generate_tasks_for_status(s, 'draft')
        Shipment.objects.filter(pk=s.pk).update(is_gapy_satys=True)
        s.refresh_from_db()
        reconcile_shipment_tasks(s, changed_fields=['is_gapy_satys'])
        titles = set(s.tasks.values_list('title_key', flat=True))
        self.assertEqual(titles, {'tasks.set_destination'})
