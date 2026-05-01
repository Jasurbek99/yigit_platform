"""Workaround for mssql-django + djangorestframework-simplejwt 5.3 + SQL Server.

Context
-------
simplejwt's ``token_blacklist.BlacklistedToken.token`` is declared as a
``OneToOneField`` (see token_blacklist/migrations/0001_initial.py). On SQL
Server the implicit ``unique=True`` produces an auto-named UNIQUE constraint
on the ``token_id`` column (e.g. ``UQ__token_bl__CB3C9E16AD44173D``).

simplejwt migration ``0008_migrate_to_bigautofield`` then ALTERs ``token_id``
from int to bigint. mssql-django 1.7's ``_alter_field`` drops the FK
constraint and the FK helper index but does *not* enumerate
``sys.key_constraints`` — so the auto-named UNIQUE constraint stays put,
SQL Server refuses the ALTER COLUMN with
``ALTER TABLE ALTER COLUMN token_id failed because one or more objects
access this column. (4922)``.

This migration runs ``run_before`` ``token_blacklist.0008`` and drops the
auto-named UNIQUE constraint dynamically (its suffix varies per database).
The constraint is restored implicitly when ``0008`` recreates the column
schema, so no reverse SQL is needed.

Removal criteria
----------------
Delete this migration if EITHER of the following ships:
- mssql-django merges PR fixing ``_alter_field`` to drop UNIQUE constraints
  before ALTER COLUMN.
- djangorestframework-simplejwt rewrites ``token_blacklist.0008`` so it
  doesn't ALTER a column with an auto-named UNIQUE constraint.
"""
from django.db import migrations


_DROP_UNIQUE_CONSTRAINT_SQL = """
DECLARE @cn nvarchar(128);
SELECT TOP 1 @cn = kc.name
FROM sys.key_constraints kc
INNER JOIN sys.index_columns ic
    ON kc.parent_object_id = ic.object_id
   AND kc.unique_index_id = ic.index_id
INNER JOIN sys.columns c
    ON ic.object_id = c.object_id
   AND ic.column_id = c.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.token_blacklist_blacklistedtoken')
  AND kc.type = 'UQ'
  AND c.name = 'token_id';
IF @cn IS NOT NULL
    EXEC('ALTER TABLE [dbo].[token_blacklist_blacklistedtoken] DROP CONSTRAINT [' + @cn + ']');
"""


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_seed_shipment_draft_status'),
        ('token_blacklist', '0007_auto_20171017_2214'),
    ]

    run_before = [
        ('token_blacklist', '0008_migrate_to_bigautofield'),
    ]

    operations = [
        migrations.RunSQL(
            sql=_DROP_UNIQUE_CONSTRAINT_SQL,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
