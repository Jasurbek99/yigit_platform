"""The one place Planning-integration code notifies people."""
from django.contrib.auth import get_user_model

from apps.export.models import Notification


def notify_roles(roles: tuple[str, ...], message: str, link: str | None = None) -> None:
    """Send an action-required notification to every active user of the roles."""
    users = get_user_model().objects.filter(role__in=roles, is_active=True).values_list('pk', flat=True)
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message[:500], link=link) for uid in users],
        batch_size=500,
    )
