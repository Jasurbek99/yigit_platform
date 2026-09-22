"""Merges the two leaves `0052_tir_takip_page_perms` left behind.

The Tır Takip page-permission rows and the in-week plan revision cap were built
on separate branches and both landed on `0051`, so the graph had two heads and
`migrate` refused. This merges them. It carries no operations — both sides are
already applied on every database that has them.

Numbered 0057 rather than 0053 on purpose: the quality_inspector chain
(`0053`–`0056`) was applied to the shared database before this merge existed,
so renumbering *those* would orphan their `django_migrations` rows. This one had
not been applied anywhere, so it is the safe side to move.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0052_tir_takip_page_perms"),
        ("core", "0056_task_rules_page_perms"),
    ]

    operations = []
