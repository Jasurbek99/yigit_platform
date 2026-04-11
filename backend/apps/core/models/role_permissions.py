"""Dynamic role-based permission models.

Three tables store admin-configurable permissions:
- RolePagePermission: which pages/routes each role can access
- RoleResourcePermission: CRUD permissions per resource per role
- RoleFieldPermission: which fields each role can edit per resource
"""
from django.db import models

from apps.core.db_utils import schema_table
from apps.core.models.user import ROLE_CHOICES


class RolePagePermission(models.Model):
    """Controls which pages/routes are visible to each role.

    page_code uses dot notation matching frontend route groups:
    'dashboard', 'export.shipments', 'admin.users', etc.
    """

    role = models.CharField(max_length=30, choices=ROLE_CHOICES)
    page_code = models.CharField(max_length=60)
    is_visible = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('core', 'role_page_permissions')
        unique_together = [('role', 'page_code')]
        verbose_name = 'Role Page Permission'
        verbose_name_plural = 'Role Page Permissions'

    def __str__(self) -> str:
        vis = 'visible' if self.is_visible else 'hidden'
        return f'{self.role} | {self.page_code} = {vis}'


class RoleResourcePermission(models.Model):
    """Controls view/create/edit/delete permissions per resource per role.

    resource_code maps to backend models: 'shipment', 'quota_issuance',
    'weekly_plan', 'price_entry', etc.
    """

    role = models.CharField(max_length=30, choices=ROLE_CHOICES)
    resource_code = models.CharField(max_length=60)
    can_view = models.BooleanField(default=False)
    can_create = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('core', 'role_resource_permissions')
        unique_together = [('role', 'resource_code')]
        verbose_name = 'Role Resource Permission'
        verbose_name_plural = 'Role Resource Permissions'

    def __str__(self) -> str:
        flags = []
        if self.can_view:
            flags.append('V')
        if self.can_create:
            flags.append('C')
        if self.can_edit:
            flags.append('E')
        if self.can_delete:
            flags.append('D')
        return f'{self.role} | {self.resource_code} = {"".join(flags) or "none"}'


class RoleFieldPermission(models.Model):
    """Controls which fields each role can edit on a given resource.

    field_name='*' means unrestricted access to all fields.
    """

    role = models.CharField(max_length=30, choices=ROLE_CHOICES)
    resource_code = models.CharField(max_length=60)
    field_name = models.CharField(max_length=60)

    class Meta:
        db_table = schema_table('core', 'role_field_permissions')
        unique_together = [('role', 'resource_code', 'field_name')]
        verbose_name = 'Role Field Permission'
        verbose_name_plural = 'Role Field Permissions'

    def __str__(self) -> str:
        return f'{self.role} | {self.resource_code}.{self.field_name}'
