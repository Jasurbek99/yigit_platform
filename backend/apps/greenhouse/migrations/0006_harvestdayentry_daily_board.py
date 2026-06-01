"""Daily harvest board fields on HarvestDayEntry (Ýük plan we galyndy page).

Adds the carried-over remainder, a freeform note, and the daily-board audit
stamp (who/when) so the daily board can record yesterday's rest + today's plan
per block independently of the weekly forecast role/window gates.
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('greenhouse', '0005_weeklyharvestplan_late_edit_extension'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='harvestdayentry',
            name='yesterday_rest_value',
            field=models.DecimalField(blank=True, decimal_places=2, help_text='Düýnki galyndy — remainder carried over from the previous day (kg). NULL = not entered.', max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='harvestdayentry',
            name='daily_note',
            field=models.CharField(blank=True, db_collation='Cyrillic_General_CI_AS', default='', help_text='Bellik — freeform daily-board note (Cyrillic/Latin mixed).', max_length=500),
        ),
        migrations.AddField(
            model_name='harvestdayentry',
            name='daily_entered_at',
            field=models.DateTimeField(blank=True, help_text='UTC timestamp of the last daily-board write (Girizilen senesi).', null=True),
        ),
        migrations.AddField(
            model_name='harvestdayentry',
            name='daily_entered_by',
            field=models.ForeignKey(blank=True, db_column='daily_entered_by', help_text='User who last wrote a daily-board value (Girizildi).', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddConstraint(
            model_name='harvestdayentry',
            constraint=models.CheckConstraint(condition=models.Q(('yesterday_rest_value__isnull', True), ('yesterday_rest_value__gte', 0), _connector='OR'), name='chk_hde_rest_gte0'),
        ),
    ]
