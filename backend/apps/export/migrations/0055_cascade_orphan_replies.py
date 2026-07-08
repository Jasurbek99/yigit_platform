from django.db import migrations


def cascade_orphan_replies(apps, schema_editor):
    """Soft-delete replies whose root was already soft-deleted.

    Historically, deleting a root comment did not cascade to its replies, so
    replies stayed is_deleted=False. They are unreachable in the drawer (which
    lists only non-deleted roots) yet still counted by comment_counts, leaving
    per-cell comment badges showing a count with an empty thread behind them.
    This clears those orphans; ViewSet.destroy now cascades going forward.
    """
    ShipmentComment = apps.get_model('export', 'ShipmentComment')
    deleted_ids = ShipmentComment.objects.filter(is_deleted=True).values('id')
    ShipmentComment.objects.filter(
        parent_comment_id__in=deleted_ids,
        is_deleted=False,
    ).update(is_deleted=True)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0054_packingtemplate_packingtemplateshare_and_more'),
    ]

    operations = [
        migrations.RunPython(cascade_orphan_replies, migrations.RunPython.noop),
    ]
