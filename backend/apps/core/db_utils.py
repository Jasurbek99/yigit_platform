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
    """Return a flat ``<schema>_<table>`` name for use as ``db_table``.

    The project formerly placed tables in MSSQL schemas (``core``, ``greenhouse``,
    ``export``) and emitted ``[schema].[table]`` here. That hit several open
    mssql-django bugs (default-constraint lookup, M2M through-table double
    brackets, ALTER COLUMN with dependent constraints, sql_flush). All tables
    now live in ``dbo`` with the schema as a name prefix instead. Same value
    on MSSQL and SQLite so backends stay aligned.

    Usage in model Meta:
        db_table = schema_table('export', 'shipments')  # -> 'export_shipments'
    """
    return f'{schema}_{table}'
