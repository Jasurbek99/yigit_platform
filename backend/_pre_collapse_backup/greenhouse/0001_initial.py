"""Transfer BlockManagerAssignment, WeeklyHarvestPlan, DomesticSale state to greenhouse app.

Tables already exist in the database (created by export migrations).
This migration only updates Django's internal state — no SQL is executed.
"""
import django.db.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('core', '0003_truck_destination'),
        ('export', '0010_quota_issuance_validity'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='BlockManagerAssignment',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('is_active', models.BooleanField(default=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('user', models.ForeignKey(db_column='user_id', on_delete=django.db.models.deletion.CASCADE, related_name='block_assignments', to=settings.AUTH_USER_MODEL)),
                        ('block', models.ForeignKey(db_column='block_id', on_delete=django.db.models.deletion.CASCADE, related_name='manager_assignments', to='core.greenhouseblock')),
                    ],
                    options={
                        'db_table': '[export].[block_manager_assignments]',
                        'ordering': ['user', 'block__code'],
                    },
                ),
                migrations.CreateModel(
                    name='WeeklyHarvestPlan',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('week_number', models.PositiveSmallIntegerField()),
                        ('year', models.PositiveSmallIntegerField()),
                        ('monday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('tuesday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('wednesday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('thursday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('friday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('saturday_plan_kg', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                        ('monday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('tuesday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('wednesday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('thursday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('friday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('saturday_actual_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                        ('actual_weekly_total_kg', models.DecimalField(blank=True, decimal_places=2, help_text='Weekly actual total when per-day breakdown is unavailable', max_digits=10, null=True)),
                        ('status', models.CharField(choices=[('draft', 'Draft'), ('submitted', 'Submitted'), ('approved', 'Approved'), ('rejected', 'Rejected')], default='draft', max_length=20)),
                        ('submitted_at', models.DateTimeField(blank=True, null=True)),
                        ('approved_at', models.DateTimeField(blank=True, null=True)),
                        ('rejected_at', models.DateTimeField(blank=True, null=True)),
                        ('rejection_note', models.CharField(blank=True, max_length=500, null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                        ('season', models.ForeignKey(db_column='season_id', on_delete=django.db.models.deletion.PROTECT, to='core.season')),
                        ('block', models.ForeignKey(db_column='block_id', on_delete=django.db.models.deletion.PROTECT, to='core.greenhouseblock')),
                        ('entered_by', models.ForeignKey(blank=True, db_column='entered_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='harvest_plans_entered', to=settings.AUTH_USER_MODEL)),
                        ('submitted_by', models.ForeignKey(blank=True, db_column='submitted_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='harvest_plans_submitted', to=settings.AUTH_USER_MODEL)),
                        ('approved_by', models.ForeignKey(blank=True, db_column='approved_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='harvest_plans_approved', to=settings.AUTH_USER_MODEL)),
                        ('rejected_by', models.ForeignKey(blank=True, db_column='rejected_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='harvest_plans_rejected', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'db_table': '[export].[weekly_harvest_plans]',
                        'ordering': ['year', 'week_number', 'block'],
                    },
                ),
                migrations.CreateModel(
                    name='DomesticSale',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('date', models.DateField()),
                        ('weight_kg', models.DecimalField(decimal_places=2, max_digits=10)),
                        ('variety', models.CharField(blank=True, max_length=50, null=True)),
                        ('price_per_kg', models.DecimalField(blank=True, decimal_places=2, max_digits=8, null=True)),
                        ('tabel_no', models.CharField(blank=True, max_length=20, null=True)),
                        ('notes', models.CharField(blank=True, max_length=500, null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('buyer', models.ForeignKey(db_column='buyer_id', on_delete=django.db.models.deletion.PROTECT, related_name='domestic_sales', to='core.domesticbuyer')),
                        ('block', models.ForeignKey(db_column='block_id', on_delete=django.db.models.deletion.PROTECT, related_name='domestic_sales', to='core.greenhouseblock')),
                        ('export_firm', models.ForeignKey(blank=True, db_column='export_firm_id', null=True, on_delete=django.db.models.deletion.PROTECT, to='core.exportfirm')),
                        ('created_by', models.ForeignKey(blank=True, db_column='created_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='domestic_sales_created', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'db_table': '[export].[domestic_sales]',
                        'ordering': ['-date', '-id'],
                    },
                ),
            ],
            database_operations=[],
        ),
        # Constraints and indexes (state-only, already exist in DB)
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddConstraint(
                    model_name='blockmanagerassignment',
                    constraint=models.UniqueConstraint(fields=['user', 'block'], name='uq_block_manager_assignment'),
                ),
                migrations.AddConstraint(
                    model_name='weeklyharvestplan',
                    constraint=models.UniqueConstraint(fields=['season', 'block', 'week_number', 'year'], name='uq_weekly_plan'),
                ),
                migrations.AddConstraint(
                    model_name='weeklyharvestplan',
                    constraint=models.CheckConstraint(
                        check=(
                            models.Q(monday_plan_kg__gte=0) &
                            models.Q(tuesday_plan_kg__gte=0) &
                            models.Q(wednesday_plan_kg__gte=0) &
                            models.Q(thursday_plan_kg__gte=0) &
                            models.Q(friday_plan_kg__gte=0) &
                            models.Q(saturday_plan_kg__gte=0)
                        ),
                        name='chk_harvest_plan_kg_gte0',
                    ),
                ),
                migrations.AddIndex(
                    model_name='weeklyharvestplan',
                    index=models.Index(fields=['status'], name='ix_harvest_plan_status'),
                ),
            ],
            database_operations=[],
        ),
    ]
