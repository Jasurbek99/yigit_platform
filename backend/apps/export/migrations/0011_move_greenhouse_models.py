"""Remove BlockManagerAssignment, WeeklyHarvestPlan, DomesticSale from export state.

These models have been transferred to the greenhouse app.
Tables remain in the database — this is a state-only migration.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0010_quota_issuance_validity'),
        ('greenhouse', '0001_initial'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(name='BlockManagerAssignment'),
                migrations.DeleteModel(name='WeeklyHarvestPlan'),
                migrations.DeleteModel(name='DomesticSale'),
            ],
            database_operations=[],
        ),
    ]
