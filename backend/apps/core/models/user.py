from django.contrib.auth.models import AbstractUser
from django.db import models

# Role choices — maps to required_role in ShipmentStatusType
ROLE_CHOICES = [
    ('export_manager', 'Export Manager'),
    ('warehouse_chief', 'Warehouse Chief'),
    ('document_team', 'Document Team'),
    ('transport', 'Transport'),
    ('sales_rep', 'Sales Rep'),
    ('finansist', 'Finansist'),
    ('director', 'Director'),
    ('accountant', 'Accountant'),
    ('greenhouse_manager', 'Greenhouse Manager'),
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
        db_table = 'sys_users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self) -> str:
        return f'{self.username} ({self.role})'
