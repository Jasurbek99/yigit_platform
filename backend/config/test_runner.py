from django.test.runner import DiscoverRunner
from django.db import connection


class MSSQLSchemaTestRunner(DiscoverRunner):
    """
    Creates required MSSQL schemas (core, greenhouse, export) on the test 
    database before migrations run. The production database has these 
    schemas pre-created by an external bootstrap step; the test runner 
    must replicate that.
    """
    REQUIRED_SCHEMAS = ['core', 'greenhouse', 'export']

    def setup_databases(self, **kwargs):
        result = super().setup_databases(**kwargs)
        # At this point, test_YIGIT_PLATFROM exists but only Django built-in
        # tables (django_migrations, contenttypes, auth) have been created.
        # We need schemas before app migrations create [core].[...] tables.
        # NOTE: super().setup_databases already ran migrations — this is too late.
        # Need to hook earlier; see implementation below.
        return result