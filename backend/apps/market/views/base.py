from django.http import Http404
from django.utils import translation
from rest_framework.exceptions import NotFound

from apps.core.services_workflow import create_audit_entry


class RussianMixin:
    """Market users read Russian; LANGUAGE_CODE is 'tk' and there is no LocaleMiddleware.

    Wrapping dispatch covers DRF/Django built-in messages (validators, 401/403, 404):
    DRF turns them into plain strings inside dispatch, before rendering.
    """

    def dispatch(self, request, *args, **kwargs):
        with translation.override('ru'):
            return super().dispatch(request, *args, **kwargs)

    def handle_exception(self, exc):
        # get_object_or_404 raises Http404 with an untranslated "No <Model> matches…".
        if isinstance(exc, Http404):
            exc = NotFound()
        return super().handle_exception(exc)


class LoginAuditMixin:
    """Audit login creation, password resets and is_active changes. Never logs the password."""

    audit_model = ''  # 'AgentLogin' | 'SellerLogin'

    def _audit(self, action: str, user, detail: str) -> None:
        create_audit_entry(self.request.user, action, self.audit_model, user.pk, user.username, detail)

    def perform_create(self, serializer):
        user = serializer.save()
        self._audit('create', user, 'login created')

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        password_reset = bool(serializer.validated_data.get('password'))
        user = serializer.save()
        if password_reset:
            self._audit('update', user, 'password reset')
        if user.is_active != was_active:
            self._audit('update', user, f'is_active → {user.is_active}')
