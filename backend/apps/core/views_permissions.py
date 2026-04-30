"""Admin CRUD endpoints for the dynamic permission system.

All endpoints are admin-only (role='admin' or is_superuser). The frontend
PermissionsPage uses these to render and save the permission matrices.
See AD-15 for the admin / director separation rationale.
"""
from django.core.cache import cache
from django.db import transaction
from rest_framework import serializers, status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import (
    RolePagePermission,
    RoleResourcePermission,
    RoleFieldPermission,
)
from apps.core.models.user import ROLE_CHOICES
from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY, RESOURCE_FIELDS


_ALL_ROLE_CODES = frozenset(r[0] for r in ROLE_CHOICES)


def _validate_matrix_roles(matrix: dict) -> list[str]:
    """Return list of ROLE_CHOICES roles missing from the matrix, if any."""
    return sorted(_ALL_ROLE_CODES - set(matrix.keys()))


class _AdminOnlyPermission(BasePermission):
    """Restrict ALL methods (including GET) to admin role and superusers.

    Permission matrix CRUD is the only system-administrator capability that
    must remain admin-only. Director and export_manager keep their operational
    pages but cannot edit who-can-do-what — see AD-15.
    """

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, 'is_superuser', False):
            return True
        return getattr(request.user, 'role', None) == 'admin'

PERM_CACHE_PREFIX = 'dynamic_perms'
ROLES = [r[0] for r in ROLE_CHOICES]


def _invalidate_perm_cache() -> None:
    """Clear all dynamic permission cache entries.

    Must match every key pattern used in permissions.py:
    - dynamic_perms:resource:{role}:{resource}  (per resource lookup)
    - dynamic_perms:pages:{role}                (page permissions)
    - dynamic_perms:resources:{role}            (all resource perms)
    - dynamic_perms:fields:{role}:{resource}    (per-resource field perms)
    - dynamic_perms:all_fields:{role}           (all field perms for /me/)
    """
    keys = []
    for role in ROLES:
        keys.append(f'{PERM_CACHE_PREFIX}:pages:{role}')
        keys.append(f'{PERM_CACHE_PREFIX}:resources:{role}')
        keys.append(f'{PERM_CACHE_PREFIX}:all_fields:{role}')
        for resource in RESOURCE_REGISTRY:
            keys.append(f'{PERM_CACHE_PREFIX}:resource:{role}:{resource}')
            keys.append(f'{PERM_CACHE_PREFIX}:fields:{role}:{resource}')
    cache.delete_many(keys)


# ── Page Permissions ─────────────────────────────────────────────────────

class PagePermissionMatrixView(APIView):
    """GET: full page permission matrix. PUT: bulk save."""

    permission_classes = [IsAuthenticated, _AdminOnlyPermission]

    def get(self, request):
        rows = RolePagePermission.objects.all().values('role', 'page_code', 'is_visible')
        matrix: dict[str, dict[str, bool]] = {}
        for row in rows:
            matrix.setdefault(row['role'], {})[row['page_code']] = row['is_visible']
        return Response({
            'roles': ROLES,
            'pages': [{'code': k, 'label': v} for k, v in PAGE_REGISTRY.items()],
            'matrix': matrix,
        })

    def put(self, request):
        """Bulk save: expects {matrix: {role: {page_code: bool}}}."""
        matrix = request.data.get('matrix', {})
        if not isinstance(matrix, dict):
            return Response({'error': 'matrix must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        missing = _validate_matrix_roles(matrix)
        if missing:
            return Response(
                {'error': f'Matrix is missing roles: {missing}. All roles must be included to prevent accidental deletion.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        objs = []
        for role, pages in matrix.items():
            if role not in _ALL_ROLE_CODES:
                continue
            for page_code, is_visible in pages.items():
                if page_code not in PAGE_REGISTRY:
                    continue
                objs.append(RolePagePermission(
                    role=role,
                    page_code=page_code,
                    is_visible=bool(is_visible),
                ))

        with transaction.atomic():
            RolePagePermission.objects.all().delete()
            RolePagePermission.objects.bulk_create(objs, batch_size=500)

        _invalidate_perm_cache()
        return Response({'status': 'ok', 'count': len(objs)})


# ── Resource Permissions ─────────────────────────────────────────────────

class ResourcePermissionMatrixView(APIView):
    """GET: full resource permission matrix. PUT: bulk save."""

    permission_classes = [IsAuthenticated, _AdminOnlyPermission]

    def get(self, request):
        rows = RoleResourcePermission.objects.all().values(
            'role', 'resource_code', 'can_view', 'can_create', 'can_edit', 'can_delete',
        )
        matrix: dict[str, dict[str, dict[str, bool]]] = {}
        for row in rows:
            matrix.setdefault(row['role'], {})[row['resource_code']] = {
                'view': row['can_view'],
                'create': row['can_create'],
                'edit': row['can_edit'],
                'delete': row['can_delete'],
            }
        return Response({
            'roles': ROLES,
            'resources': [{'code': k, 'label': v} for k, v in RESOURCE_REGISTRY.items()],
            'matrix': matrix,
        })

    def put(self, request):
        """Bulk save: expects {matrix: {role: {resource_code: {view, create, edit, delete}}}}."""
        matrix = request.data.get('matrix', {})
        if not isinstance(matrix, dict):
            return Response({'error': 'matrix must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        missing = _validate_matrix_roles(matrix)
        if missing:
            return Response(
                {'error': f'Matrix is missing roles: {missing}. All roles must be included to prevent accidental deletion.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        objs = []
        for role, resources in matrix.items():
            if role not in _ALL_ROLE_CODES:
                continue
            for resource_code, perms in resources.items():
                if resource_code not in RESOURCE_REGISTRY:
                    continue
                objs.append(RoleResourcePermission(
                    role=role,
                    resource_code=resource_code,
                    can_view=bool(perms.get('view', False)),
                    can_create=bool(perms.get('create', False)),
                    can_edit=bool(perms.get('edit', False)),
                    can_delete=bool(perms.get('delete', False)),
                ))

        with transaction.atomic():
            RoleResourcePermission.objects.all().delete()
            RoleResourcePermission.objects.bulk_create(objs, batch_size=500)

        _invalidate_perm_cache()
        return Response({'status': 'ok', 'count': len(objs)})


# ── Field Permissions ────────────────────────────────────────────────────

class FieldPermissionMatrixView(APIView):
    """GET: field permission matrix (optionally filtered by resource). PUT: bulk save."""

    permission_classes = [IsAuthenticated, _AdminOnlyPermission]

    def get(self, request):
        resource = request.query_params.get('resource')
        qs = RoleFieldPermission.objects.all()
        if resource:
            qs = qs.filter(resource_code=resource)

        rows = qs.values('role', 'resource_code', 'field_name')
        # Group: {resource_code: {role: [field_name, ...]}}
        matrix: dict[str, dict[str, list[str]]] = {}
        for row in rows:
            (matrix
             .setdefault(row['resource_code'], {})
             .setdefault(row['role'], [])
             .append(row['field_name']))

        return Response({
            'roles': ROLES,
            'resource_fields': RESOURCE_FIELDS,
            'matrix': matrix,
        })

    def put(self, request):
        """Bulk save: expects {resource: str, matrix: {role: [field_name, ...]}}."""
        resource = request.data.get('resource')
        matrix = request.data.get('matrix', {})

        if not resource or resource not in RESOURCE_REGISTRY:
            return Response(
                {'error': f'Invalid resource. Choose from: {list(RESOURCE_REGISTRY.keys())}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(matrix, dict):
            return Response({'error': 'matrix must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        # Validate field names against registry
        valid_fields = set(RESOURCE_FIELDS.get(resource, []))
        valid_fields.add('*')  # wildcard is always valid
        valid_roles = {r[0] for r in ROLE_CHOICES}

        objs = []
        for role, fields in matrix.items():
            if role not in valid_roles:
                continue
            for field_name in fields:
                if valid_fields and field_name not in valid_fields:
                    continue
                objs.append(RoleFieldPermission(
                    role=role,
                    resource_code=resource,
                    field_name=field_name,
                ))

        with transaction.atomic():
            RoleFieldPermission.objects.filter(resource_code=resource).delete()
            RoleFieldPermission.objects.bulk_create(objs, batch_size=500)

        _invalidate_perm_cache()
        return Response({'status': 'ok', 'count': len(objs)})


# ── Registry endpoint (for frontend to know available pages/resources) ───

class PermissionRegistryView(APIView):
    """Returns the full registry of pages, resources, fields, and roles."""

    permission_classes = [IsAuthenticated, _AdminOnlyPermission]

    def get(self, request):
        return Response({
            'roles': [{'code': r[0], 'label': r[1]} for r in ROLE_CHOICES],
            'pages': [{'code': k, 'label': v} for k, v in PAGE_REGISTRY.items()],
            'resources': [{'code': k, 'label': v} for k, v in RESOURCE_REGISTRY.items()],
            'resource_fields': RESOURCE_FIELDS,
        })
