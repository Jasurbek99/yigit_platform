"""Add the market-specific selling-cost categories (INTERES, PROSTOY, OTHER already exist)."""
from django.db import migrations

# (code, name_ru, name_tk, name_en, sort_order)
CATEGORIES = [
    ('KARA', 'Кара', 'Kara', 'Kara', 900),
    ('PLYONKA', 'Плёнка', 'Plýonka', 'Film', 902),
    ('ZAEZD', 'Заезд', 'Zaezd', 'Entry fee', 903),
    ('PARKOVKA', 'Парковка', 'Awtoduralga', 'Parking', 904),
]


def add_categories(apps, schema_editor):
    """Create the four market categories if missing."""
    ExpenseCategory = apps.get_model('export', 'ExpenseCategory')
    for code, name_ru, name_tk, name_en, sort_order in CATEGORIES:
        ExpenseCategory.objects.get_or_create(
            code=code,
            defaults={'name_ru': name_ru, 'name_tk': name_tk, 'name_en': name_en, 'sort_order': sort_order},
        )


def remove_categories(apps, schema_editor):
    """Delete only the four market categories."""
    ExpenseCategory = apps.get_model('export', 'ExpenseCategory')
    ExpenseCategory.objects.filter(code__in=[c[0] for c in CATEGORIES]).delete()


class Migration(migrations.Migration):
    """Data migration: market expense categories."""

    dependencies = [
        ('market', '0002_lots_sales'),
        ('export', '0049_seed_expense_categories'),
    ]

    operations = [migrations.RunPython(add_categories, remove_categories)]
