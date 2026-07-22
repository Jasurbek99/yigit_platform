from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    label = 'core'

    def ready(self):
        # Escalating brute-force lockout: bump the tier counter once per lockout
        # episode. Uses axes' own extension signal (see apps/core/security_axes.py).
        from axes.signals import user_locked_out
        from apps.core.security_axes import on_user_locked_out
        user_locked_out.connect(
            on_user_locked_out, dispatch_uid='ygt_axes_escalating_lockout',
        )
