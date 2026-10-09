from django.apps import AppConfig


class MarketConfig(AppConfig):
    """Agent market: agents at the destination bazaars, their sellers and lots."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.market'
