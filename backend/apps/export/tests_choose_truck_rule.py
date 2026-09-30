from django.test import TestCase

from apps.export.management.commands.seed_task_rules import Command as SeedTaskRules
from apps.export.models import TaskRule


class ChooseTruckRuleTests(TestCase):
    def setUp(self):
        SeedTaskRules().handle(reset=False)

    def test_choose_truck_rule_seeded(self):
        rule = TaskRule.objects.get(title_key='tasks.choose_truck')
        self.assertEqual((rule.step, rule.assignee_role, rule.target_fields), ('draft', 'export_manager', 'trip_id'))
        self.assertEqual((rule.condition_field, rule.condition_value), ('is_gapy_satys', 'False'))
        self.assertTrue(rule.is_active)

    def test_non_gapy_assign_driver_deactivated_gapy_kept(self):
        self.assertFalse(TaskRule.objects.get(title_key='tasks.assign_driver', condition_value='False').is_active)
        self.assertTrue(TaskRule.objects.get(title_key='tasks.assign_driver', condition_value='True').is_active)
