"""Seed product codes / HS codes / names, tag varieties, add pepper varieties,
put pepper on blocks D, G, M5 (2026-2027 owner table). Fills blanks only;
idempotent; safe on an empty test DB."""
from django.db import migrations

PRODUCTS = {
    'Pomidor': dict(code='tomato', hs_code='070200000', name_en='Fresh tomatoes',
                    name_ru='Помидор свежий', name_tk='Ter pomidor'),
    'Bolgar burç': dict(code='pepper', hs_code='0709601000', name_en='Fresh sweet peppers',
                        name_ru='Перец сладкий свежий', name_tk='Ter bolgar burç'),
}
PEPPER_VARIETIES = ['Maranella', 'Gialte', 'Redwing', 'Camier']
PEPPER_BLOCKS = {'D': ('Maranella', 'Gialte'), 'G': ('Redwing', 'Camier'), 'M5': ('Maranella', 'Gialte')}


def seed(apps, schema_editor):
    ProductType = apps.get_model('core', 'ProductType')
    TomatoVariety = apps.get_model('core', 'TomatoVariety')
    GreenhouseBlock = apps.get_model('core', 'GreenhouseBlock')

    products = {}
    for name, values in PRODUCTS.items():
        product, _ = ProductType.objects.get_or_create(name=name)
        for field, value in values.items():
            if not getattr(product, field):
                setattr(product, field, value)
        product.save()
        products[values['code']] = product

    TomatoVariety.objects.filter(product_type__isnull=True).update(product_type=products['tomato'])
    pepper_by_name = {}
    for name in PEPPER_VARIETIES:
        variety, _ = TomatoVariety.objects.get_or_create(
            name=name, defaults={'product_type': products['pepper']},
        )
        pepper_by_name[name] = variety

    for code, (main, secondary) in PEPPER_BLOCKS.items():
        GreenhouseBlock.objects.filter(code=code).update(
            variety_main=pepper_by_name[main], variety_secondary=pepper_by_name[secondary],
        )


class Migration(migrations.Migration):
    dependencies = [('core', '0073_product_type_fields')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
