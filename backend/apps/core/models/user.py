from django.contrib.auth.models import AbstractUser
from django.db import models

# Role choices — maps to required_role in ShipmentStatusType
ROLE_CHOICES = [
    # admin: sole top-tier system administrator. Manages users + permission matrix.
    # Director and export_manager are operational; admin is the only role that
    # can edit the permission matrix or change user roles. See AD-15.
    ('admin', 'Admin'),
    ('export_manager', 'Export Manager'),
    # loading_dept_head: head of the packaging + loading department (Soltanmyrat).
    # Same daily-work permissions as warehouse_chief; deputies hold warehouse_chief.
    # weight_master reports to this role organisationally (Kaka Findings #5).
    ('loading_dept_head', 'Loading Dept Head'),
    # loading_dept_head_deputy: deputy head of the packaging + loading department.
    # Identical access to loading_dept_head per stakeholder request (June 2026).
    ('loading_dept_head_deputy', 'Loading Dept Deputy'),
    ('warehouse_chief', 'Warehouse Chief'),
    ('weight_master', 'Weight Master'),
    ('document_team', 'Document Team'),
    ('transport', 'Transport'),
    ('sales_rep', 'Sales Rep'),
    ('finansist', 'Finansist'),
    ('director', 'Director'),
    ('accountant', 'Accountant'),
    ('greenhouse_manager', 'Greenhouse Manager'),
    ('seller', 'Seller'),
    ('boss', 'Boss'),
]


class User(AbstractUser):
    """Platform user extending Django AbstractUser.

    Maps to sys_users table in DDL v5.1.
    password_hash column is handled by Django's auth system.
    managed_blocks is DEPRECATED — use GreenhouseBlock.manager FK.
    """

    role = models.CharField(
        max_length=30,
        choices=ROLE_CHOICES,
        default='export_manager',
    )
    phone = models.CharField(max_length=20, blank=True, null=True)
    telegram_chat_id = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'sys_users'  # DDL v5.1: sys_users lives in dbo (no schema prefix intentional)
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self) -> str:
        return f'{self.username} ({self.role})'
