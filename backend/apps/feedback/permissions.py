from rest_framework.permissions import BasePermission, IsAuthenticated


class IsFeedbackAdmin(BasePermission):
    """Grants access to users whose role is 'admin'.

    Checks the explicit role-enum value, NOT is_superuser. Multiple users
    may hold the 'admin' role (e.g. ops + primary admin). Using is_superuser
    would silently exclude legitimate admins or grant access to Django
    superusers created for ops purposes.

    Always requires IsAuthenticated in combination with this permission.
    """

    def has_permission(self, request, view) -> bool:
        return (
            bool(request.user and request.user.is_authenticated)
            and getattr(request.user, 'role', None) == 'admin'
        )


class IsTicketAuthorOrAdmin(BasePermission):
    """Grants access to the ticket's author or any admin-role user.

    Used for object-level checks (retrieve, reopen) where both the
    original author and an admin should have access, but no other user.

    Always requires IsAuthenticated in combination with this permission.
    """

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        is_admin = getattr(request.user, 'role', None) == 'admin'
        is_author = obj.author_id == request.user.id
        return is_admin or is_author
