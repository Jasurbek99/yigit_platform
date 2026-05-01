"""Add field-level audit columns to AuditLog (plan D8).

Adds field_name, old_value, new_value to export.audit_log and a composite
index for efficient per-field history queries.

The mssql-django AddField with default='' on a schema-qualified table
([export].[audit_log]) triggers a default-constraint lookup bug where the
driver searches for the constraint by the bracketed table name instead of the
real MSSQL table name. To avoid this, we use RunSQL for the MSSQL-specific
ADD COLUMN statements and SeparateDatabaseAndState to keep Django model state
aligned. SQLite fallback uses standard AddField (no collation issues there).

SQLite / USE_SQLITE=true test note:
    settings.py sets MIGRATION_MODULES = {app: None} for every project app
    when USE_SQLITE=true. This causes Django to skip all migrations and build
    tables directly from models (syncdb-style), so this migration never runs
    in the SQLite test environment. The three new columns ARE included in the
    model class and therefore appear in the SQLite schema created for tests.

Additive only — existing AuditLog rows get blank defaults for all three fields.
"""
from django.db import migrations, models


# ── MSSQL raw SQL ────────────────────────────────────────────────────────────

_ADD_FIELD_NAME_SQL = (
    "ALTER TABLE [export].[audit_log] ADD [field_name] NVARCHAR(60) NOT NULL DEFAULT ''"
)
_ADD_OLD_VALUE_SQL = (
    "ALTER TABLE [export].[audit_log] ADD [old_value] NVARCHAR(MAX) "
    "COLLATE Cyrillic_General_CI_AS NOT NULL DEFAULT ''"
)
_ADD_NEW_VALUE_SQL = (
    "ALTER TABLE [export].[audit_log] ADD [new_value] NVARCHAR(MAX) "
    "COLLATE Cyrillic_General_CI_AS NOT NULL DEFAULT ''"
)
_CREATE_INDEX_SQL = (
    "CREATE INDEX [audit_field_history_idx] ON [export].[audit_log] "
    "([model_name], [object_id], [field_name], [created_at] DESC)"
)

_DROP_INDEX_SQL = "DROP INDEX [audit_field_history_idx] ON [export].[audit_log]"

# MSSQL auto-creates DEFAULT constraints when you ADD COLUMN ... DEFAULT ''.
# Those constraints must be dropped before the column can be dropped.
# We look them up dynamically because the auto-generated name is not deterministic.
_FIND_DEFAULT_CONSTRAINT_SQL = """
    SELECT dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
        ON dc.parent_object_id = c.object_id
        AND dc.parent_column_id = c.column_id
    INNER JOIN sys.tables t
        ON c.object_id = t.object_id
    INNER JOIN sys.schemas s
        ON t.schema_id = s.schema_id
    WHERE s.name = 'export'
      AND t.name = 'audit_log'
      AND c.name = %s
"""


def _drop_column_with_default(cursor, column_name: str) -> None:
    """Drop a MSSQL DEFAULT constraint then the column itself."""
    cursor.execute(_FIND_DEFAULT_CONSTRAINT_SQL, [column_name])
    row = cursor.fetchone()
    if row:
        constraint_name = row[0]
        cursor.execute(
            f'ALTER TABLE [export].[audit_log] DROP CONSTRAINT [{constraint_name}]'
        )
    cursor.execute(f'ALTER TABLE [export].[audit_log] DROP COLUMN [{column_name}]')


def _forward(apps, schema_editor):
    if schema_editor.connection.vendor == 'microsoft':
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(_ADD_FIELD_NAME_SQL)
            cursor.execute(_ADD_OLD_VALUE_SQL)
            cursor.execute(_ADD_NEW_VALUE_SQL)
            cursor.execute(_CREATE_INDEX_SQL)


def _reverse(apps, schema_editor):
    if schema_editor.connection.vendor == 'microsoft':
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(_DROP_INDEX_SQL)
            _drop_column_with_default(cursor, 'field_name')
            _drop_column_with_default(cursor, 'old_value')
            _drop_column_with_default(cursor, 'new_value')


# ── State operations (keep Django model state aligned) ──────────────────────

_STATE_ADD_FIELD_NAME = migrations.AddField(
    model_name='auditlog',
    name='field_name',
    field=models.CharField(
        blank=True,
        db_index=True,
        default='',
        help_text='Serializer field name for cell-level edit audit. Empty for transition/create rows.',
        max_length=60,
    ),
)
_STATE_ADD_OLD_VALUE = migrations.AddField(
    model_name='auditlog',
    name='old_value',
    field=models.TextField(
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        default='',
        help_text='Rendered string of the value before the edit (via _render()). May be Cyrillic.',
    ),
)
_STATE_ADD_NEW_VALUE = migrations.AddField(
    model_name='auditlog',
    name='new_value',
    field=models.TextField(
        blank=True,
        db_collation='Cyrillic_General_CI_AS',
        default='',
        help_text='Rendered string of the value after the edit (via _render()). May be Cyrillic.',
    ),
)
_STATE_ADD_INDEX = migrations.AddIndex(
    model_name='auditlog',
    index=models.Index(
        fields=['model_name', 'object_id', 'field_name', '-created_at'],
        name='audit_field_history_idx',
    ),
)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0026_sheet_row_setting'),
    ]

    operations = [
        # MSSQL: use raw SQL to avoid default-constraint lookup bug on schema-qualified tables.
        # SQLite: skip (tests use SeparateDatabaseAndState state_operations directly).
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(_forward, reverse_code=_reverse),
            ],
            state_operations=[
                _STATE_ADD_FIELD_NAME,
                _STATE_ADD_OLD_VALUE,
                _STATE_ADD_NEW_VALUE,
                _STATE_ADD_INDEX,
            ],
        ),
    ]
