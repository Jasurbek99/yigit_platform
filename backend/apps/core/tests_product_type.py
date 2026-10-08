"""ProductType fields, variety → product, block product rule (pepper spec 2026-10-05)."""
from django.test import TestCase

from apps.core.models import GreenhouseBlock, ProductType, TomatoVariety


class BlockProductRuleTests(TestCase):
    def setUp(self):
        self.tomato, _ = ProductType.objects.get_or_create(name='Pomidor')
        self.tomato.code = 'tomato'
        self.tomato.save()
        self.pepper, _ = ProductType.objects.get_or_create(name='Bolgar burç')
        self.pepper.code = 'pepper'
        self.pepper.save()
        self.defensiosa = TomatoVariety.objects.create(name='T-Def', product_type=self.tomato)
        self.maranella = TomatoVariety.objects.create(name='T-Mar', product_type=self.pepper)

    def test_block_product_is_main_variety_product(self):
        block = GreenhouseBlock.objects.create(code='XD', variety_main=self.maranella)
        self.assertEqual(block.resolve_product(), self.pepper)

    def test_sub_block_without_variety_inherits_parent(self):
        parent = GreenhouseBlock.objects.create(code='XF', variety_main=self.defensiosa)
        sub = GreenhouseBlock.objects.create(code='XF1', parent=parent)
        self.assertEqual(sub.resolve_product(), self.tomato)

    def test_block_without_variety_has_no_product(self):
        self.assertIsNone(GreenhouseBlock.objects.create(code='XN').resolve_product())

    def test_variety_without_product_gives_none(self):
        bare = TomatoVariety.objects.create(name='T-Bare')
        self.assertIsNone(GreenhouseBlock.objects.create(code='XB', variety_main=bare).resolve_product())

    def test_tomato_classmethod(self):
        self.assertEqual(ProductType.tomato(), self.tomato)


class SeedMigrationTests(TestCase):
    """The data migration ran on this (empty) test DB without failing."""

    def test_seeded_products_have_codes(self):
        self.assertTrue(ProductType.objects.filter(code='tomato', hs_code='070200000').exists())
        self.assertTrue(ProductType.objects.filter(code='pepper', hs_code='0709601000').exists())

    def test_pepper_varieties_exist(self):
        names = set(
            TomatoVariety.objects.filter(product_type__code='pepper').values_list('name', flat=True)
        )
        self.assertEqual(names, {'Maranella', 'Gialte', 'Redwing', 'Camier'})

    def test_existing_untagged_pepper_variety_is_tagged_pepper(self):
        """A pepper-named variety already in the DB with no product must not be
        swept into tomato by the "tag the rest tomato" pass."""
        import importlib

        from django.apps import apps as django_apps

        seed = importlib.import_module('apps.core.migrations.0074_seed_pepper_products').seed
        TomatoVariety.objects.filter(name='Maranella').update(product_type=None)
        TomatoVariety.objects.create(name='T-Untagged')

        seed(django_apps, None)
        seed(django_apps, None)  # idempotent

        self.assertEqual(TomatoVariety.objects.get(name='Maranella').product_type.code, 'pepper')
        self.assertEqual(TomatoVariety.objects.get(name='T-Untagged').product_type.code, 'tomato')
        self.assertEqual(TomatoVariety.objects.filter(name='Maranella').count(), 1)
