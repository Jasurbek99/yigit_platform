"""DB-compatibility utilities.

When running locally with USE_SQLITE=true the MSSQL-specific features are unavailable:
- Cyrillic_General_CI_AS collation is not supported
- Schema-qualified table names (core.seasons) are not supported

Both helpers return SQLite-compatible values under USE_SQLITE=true.
"""
import os


def _is_sqlite() -> bool:
    return os.environ.get('USE_SQLITE', 'false').lower() == 'true'


def cyrillic_collation() -> dict:
    """Return db_collation kwarg for Cyrillic text fields.

    Returns empty dict on SQLite (local dev), full kwarg for MSSQL (production).
    """
    if _is_sqlite():
        return {}
    return {'db_collation': 'Cyrillic_General_CI_AS'}


def schema_table(schema: str, table: str) -> str:
    """Return the correct db_table value for a schema-qualified MSSQL table.

    MSSQL requires '"schema"."table"' syntax so Django sends the correct
    two-part identifier. SQLite has no schemas — falls back to 'schema_table'.

    Usage in model Meta:
        db_table = schema_table('export', 'shipments')
    """
    if _is_sqlite():
        return f'{schema}_{table}'
    # mssql-django passes through names starting and ending with [...] unchanged
    # so [schema].[table] produces the correct two-part identifier
    return f'[{schema}].[{table}]'
