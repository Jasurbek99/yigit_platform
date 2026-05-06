"""Export-app-specific DRF permission classes.

The core permission infrastructure (DynamicResourcePermission, write_permission,
IsBossOrDirector, etc.) lives in apps.core.permissions. This module holds
export-domain permissions that reference export models.
"""
from rest_framework.permissions import BasePermission

# Roles that can act on ANY task, regardless of assignee_role.
# Mirrors the "supervisor" concept from the B-api plan.
_SUPERVISOR_ROLES = frozenset({'export_manager', 'boss', 'admin', 'director'})

# Only these roles may cancel a task (hard delete of work-in-flight is sensitive).
_CANCEL_ROLES = frozenset({'admin', 'director'})


class IsTaskActor(BasePermission):
    """Allow task state-change actions to the task's assignee role or supervisors.

    Rules:
      - Superusers: always allowed.
      - cancel action: only _CANCEL_ROLES (admin / director).
      - All other actions: user.role == task.assignee_role  OR
        user.role in _SUPERVISOR_ROLES.

    Object-level check (has_object_permission) is used by the TaskViewSet actions
    after retrieving the Task instance. This class does NOT override
    has_permission — the viewset sets IsAuthenticated for the list-level gate.
    """

    def has_permission(self, request, view) -> bool:
        """Allow authenticated users through the list-level gate.

        Object-level checks happen in has_object_permission.
        """
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False

        if getattr(request.user, 'is_superuser', False):
            return True

        role = getattr(request.user, 'role', None)
        action = getattr(view, 'action', None)

        if action == 'cancel':
            return role in _CANCEL_ROLES

        # For all other mutating actions: assignee_role match or supervisor.
        return role == obj.assignee_role or role in _SUPERVISOR_ROLES
