"""Remap existing shipments from retired statuses to their v2 successors.

Companion to core.0010_state_machine_v2. The status types serhet_tm, yolda,
and hasabat are retired in v2 (is_active=False) but kept in the DB for
historical audit reference. Existing shipments sitting at those codes get
remapped to the nearest active equivalent:

    serhet_tm      -> serhet_gechdi   (merged into Crossed TM Border)
    yolda          -> barysh_gumrugi  (nearest still-existing step)
    hasabat        -> tamamlandy      (merged into Report received & Completed)

Implementation notes:
  - Uses Shipment.objects.filter().update() to bypass Shipment.save() — we
    do not want to trigger task auto-resolution or auto-advance for every
    legacy row during the migration.
  - Each remap writes a ShipmentStatusLog row with is_manual_override=True
    and comment='Status remapped during state machine v2 migration' so the
    audit trail records the conversion. bulk_create batch_size=500 per
    MSSQL rules.
  - Skipped when DJANGO_TESTING=true.
"""
import os

from django.db import migrations
from django.utils import timezone


REMAP = [
    ('serhet_tm',      'serhet_gechdi'),
    ('yolda',          'barysh_gumrugi'),
    ('hasabat',        'tamamlandy'),
]


def _find_system_user(User):
    """Pick a user to credit migration-driven status log rows.

    Order of preference:
      1. username='admin' (manually created system account)
      2. role='director' (highest privilege)
      3. first user in the DB

    Returns None if there are no users at all (fresh DB during testing).
    """
    user = User.objects.filter(username='admin').first()
    if user:
        return user
    user = User.objects.filter(role='director').first()
    if user:
        return user
    return User.objects.order_by('id').first()


def apply_remap(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    Shipment = apps.get_model('export', 'Shipment')
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusLog = apps.get_model('export', 'ShipmentStatusLog')
    User = apps.get_model('core', 'User')

    system_user = _find_system_user(User)
    if system_user is None:
        # Fresh DB with no users — the migration would write status log
        # rows whose changed_by FK has nothing to point at. Skip; no
        # legacy data can exist without users anyway.
        return

    now = timezone.now()

    for old_code, new_code in REMAP:
        try:
            old_status = ShipmentStatusType.objects.get(code=old_code)
            new_status = ShipmentStatusType.objects.get(code=new_code)
        except ShipmentStatusType.DoesNotExist:
            continue

        # Snapshot shipment IDs at the old status BEFORE the update — once
        # we run the update we can't filter on the old status anymore.
        shipment_ids = list(
            Shipment.objects.filter(status_id=old_status.id).values_list('id', flat=True)
        )
        if not shipment_ids:
            continue

        # Bypass Shipment.save() — we don't want task resolution / auto-advance
        # to fire on every legacy row.
        Shipment.objects.filter(id__in=shipment_ids).update(status_id=new_status.id)

        log_rows = [
            ShipmentStatusLog(
                shipment_id=sid,
                status_id=new_status.id,
                changed_by_id=system_user.id,
                changed_at=now,
                comment=f'Status remapped during state machine v2 migration ({old_code} -> {new_code})',
                is_manual_override=True,
            )
            for sid in shipment_ids
        ]
        ShipmentStatusLog.objects.bulk_create(log_rows, batch_size=500)


def revert_remap(apps, schema_editor):
    """No-op reverse.

    The retired status types still exist in the DB (just is_active=False),
    so reversing the migration leaves data slightly off (remapped shipments
    keep the new code) but does not corrupt anything. Rolling back a
    production data migration here is not expected to be useful — the
    forward fix is to manually pick the right status if needed.
    """
    return


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0020_add_sheet_orphan_fields'),
        ('core',   '0010_state_machine_v2'),
    ]

    operations = [
        migrations.RunPython(apply_remap, reverse_code=revert_remap),
    ]
