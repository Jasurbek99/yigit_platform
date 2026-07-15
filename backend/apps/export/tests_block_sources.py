"""Tests for parent-grain block_sources normalization (Step 2).

Verifies:
- write_block_sources normalizes sub-blocks to parent and merges (F1+F2 -> F)
- close_pallet_manifest writes parent-grain block_sources from pallet net weights
- compute_block_variety_breakdown groups by (parent block x variety)
- the block-breakdown endpoint returns the breakdown
- set_block_sources action normalizes incoming sub-blocks to parent
"""
from decimal import Decimal

from django.test import TestCase

from apps.core.models import (
    Country, CrateType, GreenhouseBlock, Season, ShipmentStatusType, TomatoVariety, User,
)
from apps.export.models import Pallet, Shipment, ShipmentBlockSource
from apps.export.services import close_pallet_manifest
from apps.export.services.block_sources import (
    compute_block_variety_breakdown,
    write_block_sources,
)


def _shipment(user, blocks):
    country, _ = Country.objects.get_or_create(code='TM', defaults={'name_en': 'TM'})
    season, _ = Season.objects.get_or_create(
        name='2026', defaults={'is_active': True, 'start_date': '2026-01-01', 'end_date': '2026-12-31'},
    )
    st, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={'name_en': 'D', 'name_tk': 'D', 'name_ru': 'D', 'step_order': 0, 'phase': 'LOADING'},
    )
    return Shipment.objects.create(
        shipment_code='10AP116/26', date='2026-04-10', season=season,
        country=country, status=st, created_by=user,
    )


class BlockSourceNormalizationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='artykow', password='p', role='weight_master')
        self.f = GreenhouseBlock.objects.create(code='F', name='F')
        self.f1 = GreenhouseBlock.objects.create(code='F1', name='F1', parent=self.f)
        self.f2 = GreenhouseBlock.objects.create(code='F2', name='F2', parent=self.f)
        self.g = GreenhouseBlock.objects.create(code='G', name='G')

    def test_write_merges_sub_blocks_into_parent(self):
        shipment = _shipment(self.user, [self.f])
        n = write_block_sources(shipment, [
            {'block': self.f1.id, 'weight_kg': Decimal('9380')},
            {'block': self.f2.id, 'weight_kg': Decimal('11020')},
            {'block': self.g.id, 'weight_kg': Decimal('5000')},
        ])
        self.assertEqual(n, 2)  # F1+F2 merged into F, plus G
        rows = {bs.block.code: bs.weight_kg for bs in shipment.block_sources.select_related('block')}
        self.assertEqual(rows['F'], Decimal('20400'))  # 9380 + 11020
        self.assertEqual(rows['G'], Decimal('5000'))
        self.assertNotIn('F1', rows)
        self.assertNotIn('F2', rows)

    def test_replace_false_keeps_nothing_extra(self):
        shipment = _shipment(self.user, [self.f])
        write_block_sources(shipment, [{'block': self.f.id, 'weight_kg': Decimal('100')}])
        write_block_sources(shipment, [{'block': self.f.id, 'weight_kg': Decimal('200')}], replace=True)
        self.assertEqual(shipment.block_sources.count(), 1)
        self.assertEqual(shipment.block_sources.first().weight_kg, Decimal('200'))

    def test_set_block_sources_endpoint_merges_sub_blocks(self):
        """POST /block-sources/ with F1+F2 must write one merged F row."""
        from rest_framework.test import APIClient
        boss = User.objects.create_superuser(username='boss', password='p')
        shipment = _shipment(self.user, [self.f])
        client = APIClient()
        client.force_authenticate(boss)
        resp = client.post(
            f'/api/v1/export/shipments/{shipment.id}/block-sources/',
            {'blocks': [
                {'block_id': self.f1.id, 'weight_kg': '9000'},
                {'block_id': self.f2.id, 'weight_kg': '9000'},
            ]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['count'], 1)  # post-merge parent-row count
        rows = {bs.block.code: bs.weight_kg for bs in shipment.block_sources.select_related('block')}
        self.assertEqual(set(rows), {'F'})
        self.assertEqual(rows['F'], Decimal('18000'))


class CloseManifestBlockSourceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='artykow', password='p', role='weight_master')
        self.f = GreenhouseBlock.objects.create(code='F', name='F')
        self.f1 = GreenhouseBlock.objects.create(code='F1', name='F1', parent=self.f)
        self.f2 = GreenhouseBlock.objects.create(code='F2', name='F2', parent=self.f)
        # LEBIZ PLAST 18 (and varieties) may be seeded by migrations — get_or_create.
        self.crate, _ = CrateType.objects.get_or_create(
            name='LEBIZ PLAST 18', defaults={'weight_kg': Decimal('0.543')},
        )
        self.midelice, _ = TomatoVariety.objects.get_or_create(name='Midelice')
        self.redity, _ = TomatoVariety.objects.get_or_create(name='Redity')
        self.shipment = _shipment(self.user, [self.f])

    def _pallet(self, num, gross, sub_block, variety, count=64, pallet_w='7.5', add='4'):
        return Pallet.objects.create(
            shipment=self.shipment, pallet_number=num, crate_type=self.crate,
            crate_count=count, gross_weight_kg=Decimal(str(gross)),
            pallet_weight_kg=Decimal(pallet_w), additions_kg=Decimal(add),
            variety=variety, sub_block=sub_block, created_by=self.user,
        )

    def test_close_writes_parent_grain_block_sources(self):
        # Pre-existing draft allocation on the parent — should be replaced.
        ShipmentBlockSource.objects.create(shipment=self.shipment, block=self.f, weight_kg=Decimal('1'))
        self._pallet(1, 474, self.f1, self.midelice)   # net = 474 - 0.543*64 - 7.5 - 4 = 427.748
        self._pallet(2, 703, self.f2, self.redity, count=96)  # net = 703 - 52.128 - 7.5 - 4 = 639.372

        close_pallet_manifest(self.shipment, self.user)

        rows = {bs.block.code: bs.weight_kg for bs in self.shipment.block_sources.select_related('block')}
        self.assertEqual(set(rows), {'F'})  # F1 and F2 merged to F; draft row replaced
        self.assertEqual(rows['F'], Decimal('427.748') + Decimal('639.372'))

    def test_block_variety_breakdown(self):
        self._pallet(1, 474, self.f1, self.midelice)
        self._pallet(2, 469, self.f2, self.midelice)
        self._pallet(3, 703, self.f1, self.redity, count=96)

        breakdown = compute_block_variety_breakdown(self.shipment)
        # All under parent F; two varieties.
        by_variety = {r['variety_name']: r for r in breakdown}
        self.assertEqual(set(by_variety), {'Midelice', 'Redity'})
        self.assertTrue(all(r['block_code'] == 'F' for r in breakdown))
        # Midelice = pallet1.net + pallet2.net
        self.assertEqual(
            by_variety['Midelice']['weight_kg'],
            Decimal('427.748') + Decimal('422.748'),
        )

    def test_block_breakdown_endpoint(self):
        from rest_framework.test import APIClient
        self._pallet(1, 474, self.f1, self.midelice)
        # Read is gated by shipment.can_view (DynamicResourcePermission); the test
        # DB has no seeded role-perms, so use a superuser to exercise the endpoint.
        boss = User.objects.create_superuser(username='boss', password='p')
        client = APIClient()
        client.force_authenticate(boss)
        resp = client.get(f'/api/v1/export/shipments/{self.shipment.id}/block-breakdown/')
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body['rows']), 1)
        self.assertEqual(body['rows'][0]['block_code'], 'F')
        self.assertEqual(body['rows'][0]['variety_name'], 'Midelice')
