from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    label = 'core'
    def ready(self):
        # Existing imports/signals here, if any...
        
        # Patch mssql-django default-constraint lookup for non-dbo schemas.
        from .mssql_patches import apply_patch
        apply_patch()
