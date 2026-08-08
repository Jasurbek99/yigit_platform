"""Data migration: seed the 20 ProcessNodeLink rows for the boss process diagram.

node_id / label pairs are transcribed verbatim from the `N` array in
docs/how_works/shipment-bpmn.html (2026-08-05 boss-process-visibility).
Gateway nodes (g1-g6) and the start/end events are excluded — they have no
screen to open. `update_or_create` keyed on node_id keeps this safe to re-run
against a database that somehow already has rows.

Unlike migrations 0018/0020/0026 in apps.core (which skip entirely under
DJANGO_TESTING because they clone/widen permission-matrix rows the test
fixtures don't expect), this migration does NOT skip under DJANGO_TESTING:
its data has nothing to do with the permission matrix, and
tests_process_node_links.py depends on the 20 rows existing in the test DB
exactly as they would in production — see 0049_seed_expense_categories.py for
the same no-skip convention on a plain data seed.
"""
from django.db import migrations

# (node_id, label, route)
_LINKS = [
    ('em_weekly', 'Hepdelik maşyn planlamak', '/export/plan'),
    ('load_fc', 'Günlük hasyly çaklamak (forecast)', '/export/harvest-board'),
    ('destB', 'Maksat draft açmak (ýurt, müşderi, firma)', '/export/drafts'),
    ('supplyA', 'Üpjünçilik draft açmak (bloklar, kg)', '/export/drafts'),
    ('transA', 'Maşyn we sürüji bellemek', '/export/shipments'),
    ('join', 'Draftlary birleşdirmek (JOIN)', '/export/assign'),
    ('onetime', 'Bir saparlyk kontrakt açmak', '/contracts'),
    ('invoice', 'Invoice / faktura döretmek', '/sales'),
    ('docgen', 'Dokument generasiýa', '/documents'),
    ('customs', 'Gümrük (giriş / çykyş)', '/export/shipments/sheet'),
    ('loadtruck', 'Maşyna ýüklemek', '/export/weightmaster'),
    ('departed', 'Ýola çykarmak (departed)', '/export/shipments/board'),
    ('border', 'TM serhedinden geçmek', '/export/shipments/board'),
    ('destcust', 'Barjak ýurda girmek + gümrük', '/export/shipments/board'),
    ('peregruz', 'Pregruz (başga maşyna geçirmek)', '/export/shipments'),
    ('arrived', 'Barmaly nokadyna baryp ýetmek', '/export/shipments/board'),
    ('sell', 'Satmak (başlady → gutardy)', '/export/my-reports'),
    ('report', 'Hasabat tabşyrmak', '/export/my-reports'),
    ('accept', 'Hasabaty kabul etmek / gaýtadan işlemek', '/export/my-reports'),
    ('fin_close', 'Maliýe taýdan ýapmak', '/export/advances'),
]


def seed_process_node_links(apps, schema_editor):
    ProcessNodeLink = apps.get_model('export', 'ProcessNodeLink')
    for node_id, label, route in _LINKS:
        ProcessNodeLink.objects.update_or_create(
            node_id=node_id,
            defaults={'label': label, 'route': route, 'is_active': True},
        )


def unseed_process_node_links(apps, schema_editor):
    ProcessNodeLink = apps.get_model('export', 'ProcessNodeLink')
    node_ids = [row[0] for row in _LINKS]
    ProcessNodeLink.objects.filter(node_id__in=node_ids).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0059_processnodelink'),
    ]

    operations = [
        migrations.RunPython(seed_process_node_links, reverse_code=unseed_process_node_links),
    ]
