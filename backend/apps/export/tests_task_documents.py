"""Print tasks close when the document is downloaded (spec §3, A-1…A-3)."""
from unittest import mock

from django.utils import timezone

from apps.export.models import ShipmentDocumentDownload, TaskState
from apps.export.services import task_chain as task_chain_module
from apps.export.services.task_chain import record_document_download
from apps.export.services.task_rules import generate_tasks_for_status
from apps.export.tests_task_chain import ChainFixture, _rule


class DocumentDownloadTests(ChainFixture):
    def test_cmr_download_closes_print_cmr(self):
        _rule('gumruk_girish', 'tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.hold')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        record_document_download(s, ['cmr'], self.user)
        task = s.tasks.get(title_key='tasks.print_cmr')
        self.assertEqual((task.state, task.completed_by), (TaskState.DONE, self.user))
        self.assertTrue(ShipmentDocumentDownload.objects.filter(shipment=s, doc_key='cmr').exists())

    def test_packet_downloaded_before_the_chain_closes_later_tasks_on_arrival(self):
        _rule('gumruk_girish', 'tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.print_ct1', depends_on='tasks.print_cmr')
        _rule('gumruk_girish', 'tasks.print_phyto', depends_on='tasks.print_ct1')
        _rule('gumruk_girish', 'tasks.ct1_phyto_sent', depends_on='tasks.print_ct1,tasks.print_phyto')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        record_document_download(s, ['cmr', 'ct1', 'phyto', 'customs_request'], self.user)
        states = dict(s.tasks.values_list('title_key', 'state'))
        self.assertEqual(states['tasks.print_cmr'], TaskState.DONE)
        self.assertEqual(states['tasks.print_ct1'], TaskState.DONE)
        self.assertEqual(states['tasks.print_phyto'], TaskState.DONE)
        self.assertEqual(states['tasks.ct1_phyto_sent'], TaskState.OPEN)     # a button, not a download
        self.assertEqual(s.tasks.get(title_key='tasks.print_phyto').completed_by, self.user)

    def test_closed_season_download_changes_nothing(self):
        _rule('gumruk_girish', 'tasks.print_cmr')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        s.refresh_from_db()
        self.assertEqual(record_document_download(s, ['cmr'], self.user), [])
        self.assertFalse(ShipmentDocumentDownload.objects.filter(shipment=s).exists())
        self.assertEqual(s.tasks.get(title_key='tasks.print_cmr').state, TaskState.OPEN)

    def test_effects_apply_exactly_once_per_closed_task(self):
        """Review A1: close_auto_satisfied() already applies each closed task's
        effects; after_task_done() must not apply them a second time."""
        _rule('gumruk_girish', 'tasks.print_cmr')
        s = self._at()
        generate_tasks_for_status(s, 'gumruk_girish')
        with mock.patch.object(
            task_chain_module, 'apply_task_done_effects',
            wraps=task_chain_module.apply_task_done_effects,
        ) as spy:
            record_document_download(s, ['cmr'], self.user)
        titles = [call.args[0].title_key for call in spy.call_args_list]
        self.assertEqual(titles.count('tasks.print_cmr'), 1, titles)
