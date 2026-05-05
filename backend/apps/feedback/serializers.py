import logging

from django.db import transaction
from rest_framework import serializers

from apps.feedback.models import FeedbackAttachment, FeedbackReply, FeedbackTicket
from apps.feedback.services.files import (
    MAX_FILES_PER_PARENT,
    sanitise_filename,
    validate_attachment,
)

logger = logging.getLogger(__name__)


class FeedbackAttachmentSerializer(serializers.ModelSerializer):
    """Read-only serializer for a single file attachment."""

    file = serializers.FileField(use_url=True)

    class Meta:
        model = FeedbackAttachment
        fields = ['id', 'file', 'original_filename', 'mime_type', 'size_bytes', 'uploaded_at']
        read_only_fields = fields


class FeedbackReplySerializer(serializers.ModelSerializer):
    """Read serializer for a reply, used inside the ticket detail response."""

    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()
    attachments = FeedbackAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = FeedbackReply
        fields = [
            'id',
            'author',
            'author_name',
            'author_role',
            'content',
            'mode',
            'is_internal',
            'is_public',
            'attachments',
            'created_at',
        ]
        read_only_fields = fields

    def get_author_name(self, obj: FeedbackReply) -> str:
        return obj.author.get_full_name() or obj.author.username

    def get_author_role(self, obj: FeedbackReply) -> str:
        return obj.author.role


class FeedbackTicketListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list endpoints — no heavy nested data."""

    category_display = serializers.CharField(source='get_category_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = FeedbackTicket
        fields = [
            'id',
            'category',
            'category_display',
            'title',
            'status',
            'status_display',
            'is_public',
            'author',
            'author_name',
            'created_at',
            'last_activity_at',
        ]
        read_only_fields = fields

    def get_author_name(self, obj: FeedbackTicket) -> str:
        return obj.author.get_full_name() or obj.author.username


class FeedbackTicketDetailSerializer(serializers.ModelSerializer):
    """Full detail serializer including description, attachments, and replies.

    Replies are filtered by visibility based on who is viewing:
    - admin: all replies including internal notes
    - author (non-admin): all non-internal replies
    - public viewer: only replies with is_public=True
    The viewer is injected via serializer context as 'viewer'.
    """

    category_display = serializers.CharField(source='get_category_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    author_name = serializers.SerializerMethodField()
    attachments = FeedbackAttachmentSerializer(many=True, read_only=True)
    replies = serializers.SerializerMethodField()

    class Meta:
        model = FeedbackTicket
        fields = [
            'id',
            'category',
            'category_display',
            'title',
            'status',
            'status_display',
            'is_public',
            'author',
            'author_name',
            'description',
            'submitted_from_path',
            'submitted_from_label',
            'attachments',
            'replies',
            'created_at',
            'last_activity_at',
            'resolved_at',
        ]
        read_only_fields = fields

    def get_author_name(self, obj: FeedbackTicket) -> str:
        return obj.author.get_full_name() or obj.author.username

    def get_replies(self, obj: FeedbackTicket) -> list:
        """Return replies filtered by the requesting user's visibility level."""
        viewer = self.context.get('viewer')
        if viewer is None:
            return []

        is_admin = getattr(viewer, 'role', None) == 'admin'
        is_author = obj.author_id == viewer.id

        if is_admin:
            # Admin sees all replies including internal notes
            qs = obj.replies.all()
        elif is_author:
            # Author sees all non-internal replies (standard + public)
            qs = obj.replies.filter(is_internal=False)
        else:
            # Public viewer sees only public replies
            qs = obj.replies.filter(is_public=True)

        return FeedbackReplySerializer(qs, many=True, context=self.context).data


class FeedbackTicketCreateSerializer(serializers.ModelSerializer):
    """Writable serializer for creating a new feedback ticket.

    Attachments are received as FILES from the view, not as serializer fields,
    to support multipart/form-data uploads correctly.
    """

    class Meta:
        model = FeedbackTicket
        fields = [
            'category',
            'title',
            'description',
            'submitted_from_path',
            'submitted_from_label',
            'user_agent',
        ]

    def validate_category(self, value: str) -> str:
        valid = {choice[0] for choice in FeedbackTicket.CATEGORY_CHOICES}
        if value not in valid:
            raise serializers.ValidationError(
                f"Invalid category '{value}'. Choose from: {', '.join(sorted(valid))}"
            )
        return value

    def create(self, validated_data: dict) -> FeedbackTicket:
        """Create ticket + attachments in one atomic transaction.

        Attachments are read from self.context['files'] (set by the view).
        Each file is validated before any DB write occurs.
        """
        request = self.context['request']
        files = self.context.get('files', [])

        # Validate file count first (before creating anything)
        if len(files) > MAX_FILES_PER_PARENT:
            raise serializers.ValidationError(
                {'attachments': f"Maximum {MAX_FILES_PER_PARENT} files allowed per ticket."}
            )

        # Validate each file's content
        for f in files:
            validate_attachment(f)

        with transaction.atomic():
            ticket = FeedbackTicket.objects.create(
                author=request.user,
                **validated_data,
            )

            for f in files:
                FeedbackAttachment.objects.create(
                    ticket=ticket,
                    reply=None,
                    file=f,
                    original_filename=sanitise_filename(f.name),
                    mime_type=f.content_type or 'application/octet-stream',
                    size_bytes=f.size,
                    uploaded_by=request.user,
                )

        return ticket


class FeedbackReplyCreateSerializer(serializers.Serializer):
    """Writable serializer for admin replies.

    Handles content + mode. Attachments are received as FILES from the view.
    Side-effects (ticket.is_public flip, last_activity_at update) are handled
    in the view, not here, to keep serializer responsibility minimal.
    """

    content = serializers.CharField(max_length=4000)
    mode = serializers.ChoiceField(choices=FeedbackReply.MODE_CHOICES)

    def validate(self, attrs: dict) -> dict:
        mode = attrs.get('mode')
        valid_modes = {choice[0] for choice in FeedbackReply.MODE_CHOICES}
        if mode not in valid_modes:
            raise serializers.ValidationError(
                {'mode': f"Invalid mode '{mode}'. Choose from: {', '.join(sorted(valid_modes))}"}
            )
        return attrs


class FeedbackTicketStatusPatchSerializer(serializers.ModelSerializer):
    """Admin-only serializer for updating ticket status.

    Only 'status' is writable. Writing 'is_public' directly is rejected
    with a clear error — that flag is set server-side only via reply promotion.
    """

    class Meta:
        model = FeedbackTicket
        fields = ['status']

    def validate(self, attrs: dict) -> dict:
        # Guard against attempts to set is_public via PATCH
        if 'is_public' in self.initial_data:
            raise serializers.ValidationError(
                {
                    'is_public': (
                        "is_public cannot be set directly. "
                        "It is promoted automatically when a reply with mode='public' is posted."
                    )
                }
            )
        return attrs

    def validate_status(self, value: str) -> str:
        valid = {choice[0] for choice in FeedbackTicket.STATUS_CHOICES}
        if value not in valid:
            raise serializers.ValidationError(
                f"Invalid status '{value}'. Choose from: {', '.join(sorted(valid))}"
            )
        return value
