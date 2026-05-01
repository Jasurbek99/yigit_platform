"""Apply Cyrillic_General_CI_AS collation to TruckSplitDefault.notes.

Migration 0023 was generated under the SQLite dev shim (where
`cyrillic_collation()` returns `{}`), so the original CreateModel emitted
the column with no `db_collation` and the MSSQL CREATE TABLE inherited the
database-level default (Turkish_CI_AS on YIGIT_PLATFROM). Cyrillic admin
notes would compare and sort with the wrong locale.

This follow-up explicitly sets `Cyrillic_General_CI_AS`, matching every
other text field that holds Turkmen/Russian content (per
`.claude/rules/mssql-compat.md` and `apps.core.db_utils.cyrillic_collation`).

mssql-django's `AlterField` does not emit an `ALTER COLUMN ... COLLATE`
clause when only the collation changes, so we use raw SQL. The state
operation keeps Django's model state in sync.

Idempotent: re-running the ALTER with the same collation is a no-op on MSSQL.
SQLite has no schemas/collations — guarded by an engine check.
"""
from django.db import migrations, models


_ALTER_SQL = (
    'ALTER TABLE [export].[truck_split_defaults] '
    'ALTER COLUMN [notes] NVARCHAR(200) COLLATE Cyrillic_General_CI_AS NULL'
)


def apply_collation(apps, schema_editor):
    if schema_editor.connection.vendor != 'microsoft':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(_ALTER_SQL)


def reverse_collation(apps, schema_editor):
    """Revert to a column without explicit collation (database default)."""
    if schema_editor.connection.vendor != 'microsoft':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            'ALTER TABLE [export].[truck_split_defaults] '
            'ALTER COLUMN [notes] NVARCHAR(200) NULL'
        )


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0023_truck_split_defaults'),
    ]

    operations = [
        migrations.RunPython(apply_collation, reverse_code=reverse_collation),
        # Keep Django's frozen model state aligned with the model definition.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name='trucksplitdefault',
                    name='notes',
                    field=models.CharField(
                        blank=True,
                        db_collation='Cyrillic_General_CI_AS',
                        max_length=200,
                        null=True,
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
