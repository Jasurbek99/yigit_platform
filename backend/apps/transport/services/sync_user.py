"""The actor for poller-driven writes (comments need a non-null author)."""
from django.contrib.auth import get_user_model

from apps.core.models import User

SYNC_USERNAME = 'planning_sync'


def get_sync_user() -> User:
    """The inactive `planning_sync` account, created on first use."""
    user_model = get_user_model()
    user, created = user_model.objects.get_or_create(
        username=SYNC_USERNAME, defaults={'role': 'transport', 'is_active': False},
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=['password'])
    return user
