from django.apps import AppConfig


class ContractsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.contracts'
    label = 'contracts'

    def ready(self):
        from apps.contracts.services.task_checks import PREPARE_CONTRACT, contracts_ready
        from apps.export.services.task_chain import register_ready_check

        register_ready_check(PREPARE_CONTRACT, contracts_ready)
