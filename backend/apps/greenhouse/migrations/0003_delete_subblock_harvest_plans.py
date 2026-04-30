from django.db import migrations


def delete_subblock_plans(apps, schema_editor):
    """Remove WeeklyHarvestPlan rows for sub-blocks (e.g. OD, OG under O).

    Sub-blocks are an internal block-level control concept and never appear
    in the export/sales weekly plan grid. Earlier `initialize_harvest_week`
    seeded plans for every active block, including sub-blocks, leaving
    orphan rows that the grid should never have shown.
    """
    WeeklyHarvestPlan = apps.get_model('greenhouse', 'WeeklyHarvestPlan')
    WeeklyHarvestPlan.objects.filter(block__parent__isnull=False).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('greenhouse', '0002_fix_field_state'),
    ]

    operations = [
        migrations.RunPython(delete_subblock_plans, migrations.RunPython.noop),
    ]
