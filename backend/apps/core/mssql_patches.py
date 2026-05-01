"""
Patch for mssql-django default-constraint lookup bug with non-dbo schemas.

The upstream `_sql_select_default_constraint_name` SQL template searches
sys.tables.name = '[core].[my_table]' (with brackets and schema prefix),
but sys.tables stores just 'my_table'. As a result, the lookup returns
no match for any table in a non-dbo schema, the schema editor falls back
to dropping a constraint named after the column itself, and the migration
fails with "'<column>' is not a constraint".

Affected operations: AddField with NOT NULL + default on schema-qualified
tables ([core].[...], [greenhouse].[...], [export].[...]). 
Confirmed broken in mssql-django 1.5 and 1.7.

This module patches the SQL template at app-ready time. The new template
parses the qualified table name in T-SQL and matches against bare
sys.tables.name + sys.schemas.name correctly.

Idempotent: only patches if the buggy template is detected (so future
upstream fixes won't be silently overridden).
"""

from mssql.schema import DatabaseSchemaEditor


# Fixed template:
#   PARSENAME(@table, 1) → bare table name  (e.g. 'tomato_varieties')
#   PARSENAME(@table, 2) → schema name      (e.g. 'core')
# When the table is unqualified ('tomato_varieties'), PARSENAME(..., 2)
# returns NULL, and the COALESCE falls back to the connection's default
# schema 'dbo'. Brackets in the input are stripped via REPLACE.
_FIXED_SQL = (
    "DECLARE @qualified nvarchar(512) = REPLACE(REPLACE(%(table)s, '[', ''), ']', ''); "
    "SELECT d.name "
    "FROM sys.default_constraints d "
    "INNER JOIN sys.tables   t ON d.parent_object_id = t.object_id "
    "INNER JOIN sys.columns  c ON d.parent_object_id = c.object_id "
    "                          AND d.parent_column_id = c.column_id "
    "INNER JOIN sys.schemas  s ON t.schema_id = s.schema_id "
    "WHERE t.name = COALESCE(PARSENAME(@qualified, 1), @qualified) "
    "  AND s.name = COALESCE(PARSENAME(@qualified, 2), 'dbo') "
    "  AND c.name = %(column)s"
)


def apply_patch():
    """
    Apply the SQL template fix. Called from AppConfig.ready().
    """
    current = getattr(
        DatabaseSchemaEditor, '_sql_select_default_constraint_name', None
    )
    if current is None:
        # Upstream renamed or removed the attribute — patch no longer applicable.
        return

    if 't.name = %(table)s' not in current:
        # Template already differs from the known buggy form — assume upstream
        # fixed it. Do nothing rather than override a possibly better fix.
        return

    DatabaseSchemaEditor._sql_select_default_constraint_name = _FIXED_SQL