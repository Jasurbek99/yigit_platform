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
    # quality_inspector (Hil Gözegçi): owns the quality-certificate flags and
    # the transit-days / transport-temperature / shelf-life readings. Split out
    # of `transport` 2026-09-22 — those fields were seeded to transport with the
    # comment "R27 transit days + temp (quality inspector)" because no such role
    # existed yet. Operational only: no user/permission admin (AD-15).
    ('quality_inspector', 'Quality Inspector'),
    # garawul (gate guard): sits at one greenhouse gate (Dusak / Kaka /
    # Owadandepe) and marks trucks in and out. Bound to that gate by
    # User.loading_location. Sees only the gate screen and his gate tasks.
    ('garawul', 'Gate Guard'),
    # agent: our agent at a destination market (core.Customer), bound to it by
    # market.AgentMember. Manages its bazaars and seller logins, does not sell.
    # External user on public networks — fenced to /api/v1/market/ (see
    # CookieJWTAuthentication). Spec 2026-10-08-agent-market-sales-design.md.
    ('agent', 'Agent'),
    # agent_seller: the agent's seller at one bazaar; records sales on a phone.
    ('agent_seller', 'Agent Seller'),
    ('boss', 'Boss'),
]

# Roles of people outside YGT (agents at the destination market and their sellers).
# They may call only the auth and market APIs — enforced in CookieJWTAuthentication.
AGENT_ROLE = 'agent'
AGENT_SELLER_ROLE = 'agent_seller'
EXTERNAL_ROLES: frozenset[str] = frozenset({AGENT_ROLE, AGENT_SELLER_ROLE})


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
    # The one greenhouse gate a `garawul` works. Required for that role
    # (validated in the admin user API), unused by every other role.
    loading_location = models.ForeignKey(
        'core.LoadingLocation',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='gate_guards',
    )

    class Meta:
        db_table = 'sys_users'  # DDL v5.1: sys_users lives in dbo (no schema prefix intentional)
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self) -> str:
        return f'{self.username} ({self.role})'
