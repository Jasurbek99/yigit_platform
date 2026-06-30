from django.apps import AppConfig


class ExportConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.export'
    label = 'export'

    def ready(self):
        # Register Task Engine system checks (validates TaskRule.target_fields
        # against the Shipment model — guards against renamed-field drift).
        from . import checks  # noqa: F401
