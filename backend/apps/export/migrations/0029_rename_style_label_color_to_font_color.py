"""Rename style_label_color → style_font_color.

The field was added one migration ago (0028) under the name ``style_label_color``
and applied to the row label text in the left frozen column. The intended
purpose is the **cell text colour** (the foreground of value text inside the
row's data cells), not the row-label text. Rename the column to match the
intent before any data ships.

Reversible: the reverse rename restores ``style_label_color``.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0028_add_style_label_color'),
    ]

    operations = [
        migrations.RenameField(
            model_name='sheetrowsetting',
            old_name='style_label_color',
            new_name='style_font_color',
        ),
    ]
