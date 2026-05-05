# REQUIRED: re-export all models so Django's migration engine discovers them.
# Without this, makemigrations silently ignores the models/ package.
from .ticket import FeedbackTicket
from .reply import FeedbackReply
from .attachment import FeedbackAttachment

__all__ = ['FeedbackTicket', 'FeedbackReply', 'FeedbackAttachment']
