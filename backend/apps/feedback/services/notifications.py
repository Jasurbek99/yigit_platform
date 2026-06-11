"""In-app notifications for feedback ticket lifecycle events.

The author of a ticket is notified when an admin marks it resolved or
rejected, so they don't have to keep checking the inbox for an outcome.

The Notification model currently lives in ``apps.export`` (pending a future
move to ``apps.core``); we import it lazily inside the function to keep the
module import graph clean and to mirror the existing greenhouse exception.
"""

import logging

logger = logging.getLogger(__name__)

# Maps the terminal ticket status to the matching notification kind.
_STATUS_KIND = {
    'resolved': 'feedback_resolved',
    'rejected': 'feedback_rejected',
}


def notify_ticket_resolution(ticket, new_status: str, actor) -> None:
    """Notify the ticket author that their feedback reached a terminal status.

    Args:
        ticket: The FeedbackTicket that just changed status.
        new_status: The new terminal status ('resolved' or 'rejected').
        actor: The User who performed the status change.

    The notification is a side-effect of the status change — a failure here
    must never roll back or 500 the admin's action, so errors are logged and
    swallowed.
    """
    kind = _STATUS_KIND.get(new_status)
    if kind is None:
        return

    from apps.export.models import Notification  # noqa: PLC0415 — see module docstring

    verb = 'resolved' if new_status == 'resolved' else 'rejected'
    message = f'{actor.username} marked your feedback #{ticket.id} as {verb}'
    link = f'/feedback/my-tickets?ticket={ticket.id}'

    try:
        Notification.objects.create(
            user_id=ticket.author_id,
            kind=kind,
            message=message,
            link=link,
        )
    except Exception:  # pragma: no cover — defensive: never break the status change
        logger.warning(
            'Failed to create feedback %s notification for ticket=%s author=%s',
            new_status, ticket.id, ticket.author_id, exc_info=True,
        )
