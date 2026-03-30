# This file has been moved to apps/export/management/commands/seed_data.py
# to fix an architecture violation (core/ must not import from export/).
# Run: python manage.py seed_data (Django finds it in the export app)
raise ImportError(
    "seed_data management command has moved to apps/export. "
    "This file should be deleted."
)
