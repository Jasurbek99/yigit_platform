"""DB-compatibility utilities.

When running locally with USE_SQLITE=true the MSSQL-specific Cyrillic_General_CI_AS
collation is not available. This helper silently drops the db_collation kwarg on SQLite.
"""
import os


def cyrillic_collation() -> dict:
    """Return db_collation kwarg for Cyrillic text fields.

    Returns empty dict on SQLite (local dev), full kwarg for MSSQL (production).
    """
    if os.environ.get('USE_SQLITE', 'false').lower() == 'true':
        return {}
    return {'db_collation': 'Cyrillic_General_CI_AS'}
