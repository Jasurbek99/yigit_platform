"""Migration 0068 helper grants export.assign to the loading department.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md
"""
import importlib

from django.test import TestCase

from apps.core.models import RolePagePermission


class AssignPageGrantTests(TestCase):
    """Migration 0068 helper grants export.assign to the loading department."""

    def test_grant_creates_or_flips_rows(self):
        migration = importlib.import_module('apps.core.migrations.0068_loading_dept_assign_page')
        RolePagePermission.objects.create(role='loading_dept_head', page_code='export.assign',
                                          is_visible=False)
        migration.grant_assign_page(RolePagePermission)
        self.assertEqual(
            set(RolePagePermission.objects.filter(page_code='export.assign', is_visible=True)
                .values_list('role', flat=True)) & {'loading_dept_head', 'loading_dept_head_deputy'},
            {'loading_dept_head', 'loading_dept_head_deputy'},
        )
