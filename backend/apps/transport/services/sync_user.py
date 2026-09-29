"""The actor for poller-driven writes (comments need a non-null author)."""
from django.contrib.auth import get_user_model

SYNC_USERNAME = 'planning_sync'


def get_sync_user():
    user_model = get_user_model()
    user, created = user_model.objects.get_or_create(
        username=SYNC_USERNAME, defaults={'role': 'transport', 'is_active': False},
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=['password'])
    return user
