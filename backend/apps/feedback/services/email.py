import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _resolve_admin_recipients() -> list[str]:
    """Build the deduplicated recipient list for admin notification emails.

    Includes all active users with role='admin' who have an email address,
    plus the optional FEEDBACK_ADMIN_EMAIL env var (shared mailbox support).

    Returns:
        Deduplicated list of email addresses, preserving insertion order.
    """
    # Import here (not at module level) to respect dependency direction and
    # avoid circular import issues during app startup.
    from apps.core.models import User  # noqa: PLC0415

    in_app = list(
        User.objects
        .filter(role='admin', is_active=True)
        .exclude(email='')
        .values_list('email', flat=True)
    )
    extra = (getattr(settings, 'FEEDBACK_ADMIN_EMAIL', '') or '').strip()
    if extra:
        in_app.append(extra)

    # Deduplicate while preserving order
    seen: set[str] = set()
    return [e for e in in_app if not (e in seen or seen.add(e))]


def send_admin_new_ticket_email(ticket) -> None:
    """Fire-and-forget email to all admin recipients on new ticket submission.

    Never raises — all exceptions are logged and swallowed so that email
    failure never propagates a 500 error to the user. Called via
    transaction.on_commit() so the email is only dispatched after the
    DB transaction commits successfully.

    Args:
        ticket: A FeedbackTicket instance (must be fully saved with author loaded).
    """
    try:
        recipients = _resolve_admin_recipients()
        if not recipients:
            logger.info(
                "feedback: skipping admin email for ticket %s — no recipients configured",
                ticket.id,
            )
            return

        platform_url = (getattr(settings, 'PLATFORM_URL', '') or '').rstrip('/')
        link_line = (
            f"\n\nOpen: {platform_url}/admin/feedback?ticket={ticket.id}"
            if platform_url
            else ''
        )
        author_display = ticket.author.get_full_name() or ticket.author.username
        send_mail(
            subject=f"[YGT Feedback] {ticket.get_category_display()} — {ticket.description[:80]}",
            message=(
                f"From {author_display} ({ticket.author.role})\n\n"
                f"{ticket.description[:500]}{link_line}"
            ),
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@ygt.local',
            recipient_list=recipients,
            fail_silently=True,
        )
    except Exception:
        logger.exception(
            "feedback: admin email send failed for ticket %s",
            ticket.id,
        )
