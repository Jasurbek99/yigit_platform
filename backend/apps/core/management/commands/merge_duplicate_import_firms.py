"""Merge OLD duplicate ImportFirm rows into their canonical NEW rows.

Companion to `merge_duplicate_firms` (which handles ExportFirm). Same pattern:
the user's DB had placeholder ImportFirm rows from earlier shipment-driven
auto-creation; the Excel upsert in `import_firms_from_excel` created the
canonical rows; this command moves every FK / M2M reference from OLD to NEW
and deletes the OLD row.

ImportFirm has only two reference points (vs ExportFirm's five):

  - `export.Shipment.import_firm` : FK, on_delete=SET_NULL — plain UPDATE; no
        uniqueness on the FK alone, so a blind reassign is safe.
  - `core.Customer.import_firms`  : M2M via `core.customer_import_firms`
        junction. The junction is unique on (customer, import_firm), so a
        blind UPDATE could collide when a customer already has both OLD and
        NEW; handled with a per-customer add-then-remove loop.

Wrapped in a single `transaction.atomic`.

Usage:
    python manage.py merge_duplicate_import_firms --dry-run
    python manage.py merge_duplicate_import_firms
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import Customer, ImportFirm
from apps.export.models import Shipment


# Each entry: (old_id, new_id, comment).
# Identified by matching name_company across the NULL-code "placeholder" rows
# (created earlier by shipment imports) and the Excel-imported canonical rows.
# All pairs verified manually against the DB before applying.
IMPORT_FIRM_MERGES: list[tuple[int, int, str]] = [
    # 12 confident NULL-code placeholders -> canonical Excel rows
    ( 3,  25, "Aranşy KZ -> TОО «Араншы-KZ»"),
    ( 6,   2, "NUR ALEM -> Nur-Alem"),
    ( 8, 120, "Eko-Bay Keyji -> ООО «Эко-Бай Кейджи»"),
    ( 9, 129, "LLC \"Aries Line\" -> ОсОО «Ариес Лайн»"),
    (12, 108, "LLC «Glavryba» -> ОсОО «Главрыба»"),
    (13, 129, "Aries layn -> ОсОО «Ариес Лайн»"),
    (14, 122, "Exportlink -> OOO «EXPORTLINK»"),
    (15,  53, "MTLK ISHENIM -> ОсОО «МТЛК Ишеним»"),
    (16,  68, "Trust industry -> TRUST INDUSTRY"),
    (20,  80, "Krasnyy Apelsin -> ОсОО «КРАСНЫЙ АПЕЛЬСИН»"),
    (21, 119, "Freshworld Trade -> ООО «FRESHWORLD TRADE»"),
    (23, 134, "Dar Zemli -> ООО «Дар земли»"),
    # User-confirmed ambiguous pairs
    ( 7, 100, "Tel Tursynbayew -> ИП ТУРСЫНБАЕВ (the only one in DB)"),
    (11,  44, "Dargo-88 -> LLC DARGOH88"),
    ( 5, 102, "Trans Asia Trade -> ТОО TransAsia Trade (Bagtyyar)"),
    # Cross-Excel duplicates (user said merge; pick cleaner-code as canonical)
    (18, 130, "LLC «Tauminoti Aulo» -> Tauminoti Aulo (canonical short code)"),
    (111, 132, "OcOO \"Town Express Company\" -> TOWN Express Company (canonical short code)"),
]


class Command(BaseCommand):
    help = 'Merge OLD duplicate ImportFirm rows into their canonical NEW rows'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Run inside a transaction that rolls back at the end.')

    def handle(self, *args, **opts):
        dry_run: bool = opts['dry_run']

        resolved: list[tuple[ImportFirm, ImportFirm, str]] = []
        for old_id, new_id, label in IMPORT_FIRM_MERGES:
            old = ImportFirm.objects.filter(id=old_id).first()
            new = ImportFirm.objects.filter(id=new_id).first()
            if old is None:
                self.stdout.write(self.style.WARNING(
                    f'  SKIP  no OLD ImportFirm with id={old_id} ({label}) (already merged?)'))
                continue
            if new is None:
                raise CommandError(
                    f'NEW ImportFirm with id={new_id} not found '
                    f'(target for OLD={old_id} / {label})')
            if old.id == new.id:
                raise CommandError(
                    f'OLD and NEW resolved to the same id: {old.id} ({label})')
            resolved.append((old, new, label))

        if not resolved:
            self.stdout.write(self.style.SUCCESS('Nothing to merge.'))
            return

        with transaction.atomic():
            totals = {
                'Shipment.import_firm': 0,
                'Customer.import_firms (junction reassigned)': 0,
                'Customer.import_firms (junction collapsed)':  0,
            }

            for old, new, label in resolved:
                self.stdout.write('')
                self.stdout.write(self.style.MIGRATE_HEADING(
                    f'MERGE  [id={old.id} "{(old.name_company or "")[:30]}"]  ->  '
                    f'[id={new.id} "{(new.name_company or "")[:30]}"]  ({label})'))

                # Shipment FK — plain UPDATE
                ship_count = Shipment.objects.filter(import_firm=old).update(import_firm=new)
                if ship_count:
                    totals['Shipment.import_firm'] += ship_count
                    self.stdout.write(
                        f'    {"export.Shipment.import_firm":40}  reassigned {ship_count}')

                # Customer M2M — add NEW where OLD is present, remove OLD.
                # add() is idempotent on M2M (no-op if already there).
                customers_with_old = list(Customer.objects.filter(import_firms=old))
                if customers_with_old:
                    reassigned = collapsed = 0
                    for cust in customers_with_old:
                        already_had_new = cust.import_firms.filter(id=new.id).exists()
                        cust.import_firms.add(new)
                        cust.import_firms.remove(old)
                        if already_had_new:
                            collapsed += 1
                        else:
                            reassigned += 1
                    totals['Customer.import_firms (junction reassigned)'] += reassigned
                    totals['Customer.import_firms (junction collapsed)']  += collapsed
                    self.stdout.write(
                        f'    {"core.Customer.import_firms":40}  '
                        f'{len(customers_with_old)} customer(s): '
                        f'{reassigned} reassigned, {collapsed} collapsed')

                old_id_val, old_name = old.id, (old.name_company or '')[:30]
                old.delete()
                self.stdout.write(
                    f'    {"ImportFirm (old)":40}  deleted id={old_id_val} name={old_name!r}')

            if dry_run:
                self.stdout.write('')
                self.stdout.write(self.style.WARNING(
                    'DRY RUN — rolling back transaction.'))
                transaction.set_rollback(True)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=== Summary ==='))
        self.stdout.write(f'  Pairs processed : {len(resolved)}')
        for k, v in totals.items():
            self.stdout.write(f'  {k:45}  {v}')
