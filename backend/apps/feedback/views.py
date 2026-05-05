import logging

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.feedback.models import FeedbackAttachment, FeedbackReply, FeedbackTicket
from apps.feedback.permissions import IsFeedbackAdmin
from apps.feedback.serializers import (
    FeedbackReplyCreateSerializer,
    FeedbackReplySerializer,
    FeedbackTicketCreateSerializer,
    FeedbackTicketDetailSerializer,
    FeedbackTicketListSerializer,
    FeedbackTicketStatusPatchSerializer,
)
from apps.feedback.services.email import send_admin_new_ticket_email
from apps.feedback.services.files import (
    MAX_FILES_PER_PARENT,
    sanitise_filename,
    validate_attachment,
)

logger = logging.getLogger(__name__)


class FeedbackTicketViewSet(ModelViewSet):
    """ViewSet for the Feedback Module ticket inbox.

    Visibility rules (first match wins):
    1. Admin (role='admin') → sees all tickets + all replies including internal.
    2. Author (ticket.author == request.user) → sees own tickets + non-internal replies.
    3. Public (ticket.is_public=True, ?scope=public) → sees public tickets + public replies.
    4. Otherwise → ticket excluded from list, 403 from detail.

    Scope query parameter:
    - ?scope=mine (default for non-admin): own tickets only
    - ?scope=public: is_public=True tickets, accessible to any authenticated user
    - ?scope=all (admin only): full inbox with filter support
    """

    queryset = FeedbackTicket.objects.select_related('author').prefetch_related(
        'attachments',
        'replies__attachments',
        'replies__author',
    )
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # ── Permission dispatch ────────────────────────────────────────────────────

    def get_permissions(self):
        """Return permission classes based on the action being performed."""
        if self.action in ('partial_update', 'update', 'destroy'):
            return [IsAuthenticated(), IsFeedbackAdmin()]
        if self.action in ('reply', 'admin_unread_count'):
            return [IsAuthenticated(), IsFeedbackAdmin()]
        # For retrieve, the queryset already gates access correctly:
        # - admin sees all, non-admin sees own + public tickets.
        # A peer reaching a ticket via the queryset can only see it if
        # is_public=True, and the detail serializer applies reply visibility.
        # 404 (not in queryset) is preferable to 403 (reveals existence).
        # All other actions (create, list, reopen) require only auth;
        # object-level checks are done inside the action methods.
        return [IsAuthenticated()]

    # ── Serializer dispatch ────────────────────────────────────────────────────

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return FeedbackTicketDetailSerializer
        if self.action == 'create':
            return FeedbackTicketCreateSerializer
        if self.action == 'partial_update':
            return FeedbackTicketStatusPatchSerializer
        return FeedbackTicketListSerializer

    def get_serializer_context(self) -> dict:
        """Inject viewer into context so reply visibility filter works in detail."""
        ctx = super().get_serializer_context()
        ctx['viewer'] = self.request.user
        return ctx

    # ── Queryset filtering ─────────────────────────────────────────────────────

    def get_queryset(self) -> QuerySet:
        """Filter tickets based on viewer identity, scope, and search parameters.

        For detail (retrieve) actions, non-admin users can see their own tickets
        AND any ticket marked is_public=True. This allows direct-URL access to
        public tickets without requiring ?scope=public in the URL. A 404 is
        returned when the ticket is neither owned by the user nor public —
        which is the correct response (better than 403 which reveals existence).

        For list actions:
        - ?scope=public : is_public=True tickets only (any authenticated user)
        - ?scope=mine   : own tickets only (useful for admin too)
        - no scope      : admin sees all; non-admin defaults to 'mine'
        """
        user = self.request.user
        is_admin = getattr(user, 'role', None) == 'admin'
        scope = self.request.query_params.get('scope', '')

        if is_admin and scope != 'mine':
            # Admin sees all tickets (full inbox); respect explicit ?scope=mine
            qs = self.queryset.all()
        elif scope == 'public':
            # Public Feed — is_public=True tickets visible to all authenticated users
            qs = self.queryset.filter(is_public=True)
        elif self.action == 'retrieve':
            # Detail access: own tickets OR public tickets (no scope param required)
            qs = self.queryset.filter(Q(author=user) | Q(is_public=True))
        else:
            # Non-admin list default, or admin ?scope=mine: own tickets only
            qs = self.queryset.filter(author=user)

        # Apply filters (mainly useful for admin scope=all)
        qs = self._apply_filters(qs)
        return qs

    def _apply_filters(self, qs: QuerySet) -> QuerySet:
        """Apply query-param filters to a base queryset."""
        params = self.request.query_params

        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        category_param = params.get('category')
        if category_param:
            qs = qs.filter(category=category_param)

        author_param = params.get('author')
        if author_param:
            qs = qs.filter(author_id=author_param)

        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(title__icontains=search) | Q(description__icontains=search)
            )

        date_from = params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs

    # ── Standard CRUD ─────────────────────────────────────────────────────────

    def create(self, request: Request, *args, **kwargs) -> Response:
        """Create a ticket + optional attachments, then email admins on commit."""
        serializer = self.get_serializer(
            data=request.data,
            context={
                'request': request,
                'files': request.FILES.getlist('attachments'),
                'viewer': request.user,
            },
        )
        serializer.is_valid(raise_exception=True)

        # Ticket creation (with attachments) is atomic inside serializer.create()
        with transaction.atomic():
            ticket = serializer.save()
            # Schedule email after the transaction commits — guarantees we never
            # send an email for a ticket that gets rolled back.
            transaction.on_commit(lambda: send_admin_new_ticket_email(ticket))

        detail_serializer = FeedbackTicketDetailSerializer(
            ticket,
            context={'request': request, 'viewer': request.user},
        )
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        """Admin-only: update ticket status. Sets resolved_at on terminal statuses."""
        ticket = self.get_object()
        serializer = self.get_serializer(ticket, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        new_status = serializer.validated_data.get('status')
        extra_fields: dict = {}
        if new_status in ('resolved', 'rejected') and ticket.status not in ('resolved', 'rejected'):
            extra_fields['resolved_at'] = timezone.now()
        elif new_status and new_status not in ('resolved', 'rejected'):
            # Moving away from a terminal state clears resolved_at
            extra_fields['resolved_at'] = None

        serializer.save(**extra_fields)

        detail_serializer = FeedbackTicketDetailSerializer(
            ticket,
            context={'request': request, 'viewer': request.user},
        )
        return Response(detail_serializer.data)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """Full PUT is not supported — use PATCH."""
        return Response(
            {'error': 'Full update not allowed. Use PATCH to update status.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    # ── Custom actions ─────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request: Request, pk=None) -> Response:
        """Author action: reopen a resolved or rejected ticket.

        Only the ticket author may reopen. Status must be 'resolved' or 'rejected'.
        Sets status='in_review', clears resolved_at, bumps last_activity_at.
        """
        ticket = self.get_object()

        # Object-level: only author (admin can patch status directly, no need for reopen)
        if ticket.author_id != request.user.id:
            return Response(
                {'error': 'Only the ticket author can reopen a ticket.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if ticket.status not in ('resolved', 'rejected'):
            return Response(
                {'error': f"Cannot reopen a ticket with status '{ticket.status}'. "
                          f"Only resolved or rejected tickets can be reopened."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ticket.status = 'in_review'
        ticket.resolved_at = None
        ticket.last_activity_at = timezone.now()
        ticket.save(update_fields=['status', 'resolved_at', 'last_activity_at'])

        detail_serializer = FeedbackTicketDetailSerializer(
            ticket,
            context={'request': request, 'viewer': request.user},
        )
        return Response(detail_serializer.data)

    @action(detail=True, methods=['post'], url_path='reply',
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def reply(self, request: Request, pk=None) -> Response:
        """Admin action: post a reply with optional file attachments.

        If mode='public', the parent ticket is also marked is_public=True.
        Attachments are validated before any DB write. All writes are atomic.
        """
        ticket = self.get_object()

        reply_serializer = FeedbackReplyCreateSerializer(data=request.data)
        reply_serializer.is_valid(raise_exception=True)

        files = request.FILES.getlist('attachments')
        if len(files) > MAX_FILES_PER_PARENT:
            return Response(
                {'error': f"Maximum {MAX_FILES_PER_PARENT} files allowed per reply."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate all files before entering the transaction
        for f in files:
            validate_attachment(f)

        with transaction.atomic():
            reply = FeedbackReply.objects.create(
                ticket=ticket,
                author=request.user,
                content=reply_serializer.validated_data['content'],
                mode=reply_serializer.validated_data['mode'],
                # is_internal and is_public are synced in FeedbackReply.save()
            )

            for f in files:
                FeedbackAttachment.objects.create(
                    ticket=None,
                    reply=reply,
                    file=f,
                    original_filename=sanitise_filename(f.name),
                    mime_type=f.content_type or 'application/octet-stream',
                    size_bytes=f.size,
                    uploaded_by=request.user,
                )

            # Side-effect: if this reply is public, promote the ticket too
            if reply.is_public and not ticket.is_public:
                ticket.is_public = True
                ticket.last_activity_at = timezone.now()
                ticket.save(update_fields=['is_public', 'last_activity_at'])
            else:
                # Bump last_activity_at explicitly to make the intent clear
                ticket.last_activity_at = timezone.now()
                ticket.save(update_fields=['last_activity_at'])

        reply_data = FeedbackReplySerializer(
            reply,
            context={'request': request, 'viewer': request.user},
        ).data
        return Response(reply_data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='admin_unread_count')
    def admin_unread_count(self, request: Request) -> Response:
        """Admin action: return count of tickets with status='new'.

        Used by the frontend sidebar badge to show the unread indicator.
        """
        count = FeedbackTicket.objects.filter(status='new').count()
        return Response({'count': count})
