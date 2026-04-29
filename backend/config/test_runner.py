"""Custom test runner that registers Cyrillic_General_CI_AS collation for SQLite.

When USE_SQLITE=true, the Cyrillic_General_CI_AS collation (used by all text
fields storing Turkmen/Russian content) is not supported by SQLite out of the
box. This runner patches Django's SQLite backend to register the collation on
every new database connection.

The collation is registered as a case-insensitive unicode comparator — this is
not byte-exact Cyrillic comparison but is sufficient for test correctness
(tests check equality, not locale-specific ordering).

Usage in settings.py:
    TEST_RUNNER = 'config.test_runner.CyrillicSQLiteTestRunner'
"""
import os

from django.test.runner import DiscoverRunner


def _cyrillic_collation(a: str, b: str) -> int:
    """Simple Unicode collation stub for SQLite (case-insensitive)."""
    a_norm, b_norm = a.casefold(), b.casefold()
    if a_norm < b_norm:
        return -1
    if a_norm > b_norm:
        return 1
    return 0


def _patch_sqlite_backend() -> None:
    """Monkey-patch Django's SQLite backend to register the Cyrillic collation.

    We override the ``get_new_connection`` classmethod so that every connection
    created by Django (including the test-DB in-memory connection) registers the
    collation before any SQL is executed.
    """
    try:
        from django.db.backends.sqlite3.base import DatabaseWrapper
    except ImportError:
        return  # Not using SQLite backend — no-op

    _original_get_new_connection = DatabaseWrapper.get_new_connection

    def _patched_get_new_connection(self, conn_params):
        conn = _original_get_new_connection(self, conn_params)
        conn.create_collation('Cyrillic_General_CI_AS', _cyrillic_collation)
        return conn

    DatabaseWrapper.get_new_connection = _patched_get_new_connection


class CyrillicSQLiteTestRunner(DiscoverRunner):
    """Test runner that patches SQLite with a Cyrillic collation stub.

    Only active when USE_SQLITE=true — has no effect on MSSQL connections.
    """

    def setup_test_environment(self, **kwargs):
        if os.environ.get('USE_SQLITE', 'false').lower() == 'true':
            _patch_sqlite_backend()
        super().setup_test_environment(**kwargs)
