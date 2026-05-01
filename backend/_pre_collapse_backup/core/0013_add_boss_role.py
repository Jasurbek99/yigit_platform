"""Add boss role to User.role + permission models.

Boss is a strictly read-only executive role that lands on /boss/dashboard.
Director is granted access to the same dashboard via seed_permissions
(no migration needed — director already has all pages by default).
"""

from django.db import migrations, models


_NEW_CHOICES = [
    ('export_manager', 'Export Manager'),
    ('warehouse_chief', 'Warehouse Chief'),
    ('weight_master', 'Weight Master'),
    ('document_team', 'Document Team'),
    ('transport', 'Transport'),
    ('sales_rep', 'Sales Rep'),
    ('finansist', 'Finansist'),
    ('director', 'Director'),
    ('accountant', 'Accountant'),
    ('greenhouse_manager', 'Greenhouse Manager'),
    ('seller', 'Seller'),
    ('boss', 'Boss'),
]


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_alter_rolefieldpermission_role_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=_NEW_CHOICES, default='export_manager', max_length=30),
        ),
        migrations.AlterField(
            model_name='rolefieldpermission',
            name='role',
            field=models.CharField(choices=_NEW_CHOICES, max_length=30),
        ),
        migrations.AlterField(
            model_name='rolepagepermission',
            name='role',
            field=models.CharField(choices=_NEW_CHOICES, max_length=30),
        ),
        migrations.AlterField(
            model_name='roleresourcepermission',
            name='role',
            field=models.CharField(choices=_NEW_CHOICES, max_length=30),
        ),
    ]
