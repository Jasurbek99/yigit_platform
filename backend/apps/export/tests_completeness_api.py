"""API-level test for the `completeness` block on the shipment detail endpoint.

Verifies compute_completeness() (apps/export/services/completeness.py,
covered by tests_completeness.py) is wired onto GET
/api/v1/export/shipments/{id}/ via ShipmentDetailSerializer. Own module
because tests_completeness.py is already at the 200-line file cap.
"""
from rest_framework.test import APITestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import Shipment, TaskRule


class CompletenessApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30',
            is_active=True,
        )
        cls.loading = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Loading', step_order=3,
        )
        # Read is gated by shipment.can_view (DynamicResourcePermission); the
        # test DB has no seeded role-perms, so use a superuser to exercise
        # the endpoint (same pattern as tests_block_sources.py).
        cls.user = User.objects.create_superuser(username='manager', password='pw')
        TaskRule.objects.create(
            step='yuklenme', title_key='tasks.fill_loading_data',
            assignee_role='loading_dept_head', target_fields='weight_net,pallet_count',
        )

    def test_detail_includes_completeness(self):
        shipment = Shipment.objects.create(
            shipment_code='0101002/26', date='2026-01-01',
            status=self.loading, season=self.season,
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(f'/api/v1/export/shipments/{shipment.id}/')

        self.assertEqual(response.status_code, 200)
        block = response.data['completeness']
        self.assertEqual(block['required_total'], 2)
        self.assertEqual(block['filled_count'], 0)
        self.assertEqual(
            sorted(m['key'] for m in block['missing_fields']),
            ['pallet_count', 'weight_net'],
        )
