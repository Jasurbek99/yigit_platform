"""Merge duplicate ExportFirm rows that came from prior shipment-driven
auto-creation (wrong codes / placeholder names) into the canonical rows that
were upserted from data/export_import_firms.xlsx.

For each (old_code -> new_code) pair we walk every FK relation pointing at
ExportFirm and move each row from old to new. Three of those tables have a
UNIQUE constraint that includes export_firm, so a blind UPDATE would crash;
those tables get a custom **merge** path that sums the numeric columns into
the existing NEW row instead of trying to insert a duplicate.

Conflict handling per table:
  - greenhouse.DomesticSale            : no uniqueness — plain UPDATE
  - export.QuotaUsageRecord            : no uniqueness — plain UPDATE
  - export.ShipmentFirmSplit           : unique (shipment, export_firm)
        → if NEW already has a split for the same shipment, sum weight_kg +
          amount_usd into NEW's row and delete OLD's row; else UPDATE
  - export.QuotaIssuanceFirmAllocation : unique (issuance, export_firm)
        → same pattern — sum kg_quota, delete OLD; else UPDATE
  - export.WeeklyLocalSellPlan         : unique (export_firm, week_number, year)
        → sum monday..saturday_plan_kg into NEW's row, delete OLD; else UPDATE

After all FK rows are moved, the OLD ExportFirm row has no protected
references and is safe to DELETE.

Wrapped in a single `transaction.atomic`.

Usage:
    python manage.py merge_duplicate_firms --dry-run
    python manage.py merge_duplicate_firms
"""
from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum

from apps.core.models import ExportFirm
from apps.export.models import (
    QuotaIssuanceFirmAllocation,
    QuotaUsageRecord,
    ShipmentFirmSplit,
    WeeklyLocalSellPlan,
)
from apps.greenhouse.models import DomesticSale


# OLD code -> NEW code mapping. OLD is the placeholder row that pre-existed
# the Excel upsert; NEW is the canonical Excel row. See name_tk matches:
#   OLD 'GOK BOLUT'              -> NEW '"Gök bulut" HJ'
#   OLD 'AKBULUT'                -> NEW '"Ak Bulut" HJ'
#   OLD 'MIWELI ATYZ'            -> NEW '"Miweli atyz" HJ'
#   OLD 'YUMAK'                  -> NEW '"Ýumak" HJ'
#   OLD 'YGTYBARLY'              -> NEW '"Ygtybarly enjamlar" JH'
#   OLD 'ISGAR HJ'               -> NEW '"Işgär" HJ'
#   OLD 'Tel Amangeldiyew G'     -> NEW 'Telekeçi Amangeldiýew G.'
#   OLD 'Tel Dowranow E'         -> NEW 'Hususy Telekeçi Döwranow E.A.'
#   OLD 'Tel Dowranow J'         -> NEW 'Hususy Telekeçi Döwranow J.A.'
#   OLD 'Tel Hemidow P'          -> NEW 'Hususy Telekeçi Hemidow P.'
#   OLD 'Tel Hemidow C'          -> NEW 'Hususy Telekeçi Hemidow Ç. A.'  (Ç often typed as C in legacy data)
#   OLD 'Tel Jumamyradow G'      -> NEW 'Hususy Telekeçi Jumamyradow G.J'  (Gurban Jumamyradow, last-first)
#   OLD 'Tel Gurban J'           -> NEW 'Hususy Telekeçi Jumamyradow G.J'  (same person, first-last form)
#
# NOT merged (no Excel equivalent — left in place):
#   'Tel Guwanc A.' (TELGUWANC)
EXPORT_FIRM_MERGES: list[tuple[str, str]] = [
    ('GOKBOLUT',    'GB'),
    ('AKBULUT',     'AB'),
    ('MIWELIATY',   'MA'),
    ('YUMAK',       'YMK'),
    ('YGTYBARLY',   'YE'),
    ('ISGARHJ',     'ISH'),
    ('TELAMANG',    'Tel GA'),
    ('TELDOWRA16',  'Tel ED'),
    ('TELDOWRAN',   'Tel JD'),
    ('TELHEMID10',  'Tel PH'),
    ('Tel Hem C',   'Tel CH'),
    ('TELJUMAMY',   'Tel GJ'),
    ('TELGURBAN',   'Tel GJ'),
]


class Command(BaseCommand):
    help = 'Merge OLD duplicate ExportFirm rows into their canonical NEW rows'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Run inside a transaction that rolls back at the end.')

    def handle(self, *args, **opts):
        dry_run: bool = opts['dry_run']

        # Resolve every (old, new) pair up-front so a typo fails before mutation.
        resolved: list[tuple[ExportFirm, ExportFirm]] = []
        for old_code, new_code in EXPORT_FIRM_MERGES:
            old = ExportFirm.objects.filter(code=old_code).first()
            new = ExportFirm.objects.filter(code=new_code).first()
            if old is None:
                self.stdout.write(self.style.WARNING(
                    f'  SKIP  no OLD firm with code={old_code!r} (already merged?)'))
                continue
            if new is None:
                raise CommandError(
                    f'NEW firm with code={new_code!r} not found '
                    f'(expected target for OLD={old_code!r}); '
                    'did you run import_firms_from_excel first?')
            if old.id == new.id:
                raise CommandError(
                    f'OLD and NEW resolved to the same row: id={old.id} '
                    f'({old_code} / {new_code})')
            resolved.append((old, new))

        if not resolved:
            self.stdout.write(self.style.SUCCESS('Nothing to merge.'))
            return

        with transaction.atomic():
            totals = {
                'DomesticSale':                    0,
                'ShipmentFirmSplit_reassigned':    0,
                'ShipmentFirmSplit_merged':        0,
                'WeeklyLocalSellPlan_reassigned':  0,
                'WeeklyLocalSellPlan_merged':      0,
                'QuotaIssuanceFirmAllocation_reassigned': 0,
                'QuotaIssuanceFirmAllocation_merged':     0,
                'QuotaUsageRecord':                0,
            }

            for old, new in resolved:
                self.stdout.write('')
                self.stdout.write(self.style.MIGRATE_HEADING(
                    f'MERGE  [{old.code}] id={old.id} "{(old.name_tk or "")[:30]}"  ->  '
                    f'[{new.code}] id={new.id} "{(new.name_tk or "")[:30]}"'))

                self._move_simple(DomesticSale, 'greenhouse.DomesticSale',
                                  old, new, totals, 'DomesticSale')
                self._move_simple(QuotaUsageRecord, 'export.QuotaUsageRecord',
                                  old, new, totals, 'QuotaUsageRecord',
                                  sum_field='kg_used')
                self._move_shipment_firm_split(old, new, totals)
                self._move_weekly_local_sell_plan(old, new, totals)
                self._move_quota_issuance_allocation(old, new, totals)

                old_id, old_code = old.id, old.code
                old.delete()
                self.stdout.write(
                    f'    {"ExportFirm (old)":40}  deleted id={old_id} code={old_code!r}')

            if dry_run:
                self.stdout.write('')
                self.stdout.write(self.style.WARNING(
                    'DRY RUN — rolling back transaction.'))
                transaction.set_rollback(True)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('=== Summary ==='))
        self.stdout.write(f'  Pairs processed : {len(resolved)}')
        for k, v in totals.items():
            self.stdout.write(f'  {k:42}  {v}')

    # ── per-table movers ──────────────────────────────────────────────────────
    def _move_simple(self, model, label: str, old, new, totals: dict,
                     tally_key: str, *, sum_field: str | None = None) -> None:
        """No-uniqueness table: plain UPDATE of FK."""
        qs = model.objects.filter(export_firm=old)
        count = qs.count()
        if not count:
            return
        extra = ''
        if sum_field:
            total = qs.aggregate(s=Sum(sum_field))['s'] or 0
            extra = f'  (sum {sum_field} = {total:,.0f})'
        qs.update(export_firm=new)
        totals[tally_key] += count
        self.stdout.write(f'    {label:40}  reassigned {count} row(s){extra}')

    def _move_shipment_firm_split(self, old, new, totals: dict) -> None:
        """Unique (shipment, export_firm): merge weight + amount on conflict."""
        old_rows = list(ShipmentFirmSplit.objects.filter(export_firm=old))
        if not old_rows:
            return
        reassigned = merged = 0
        for old_row in old_rows:
            new_row = ShipmentFirmSplit.objects.filter(
                shipment=old_row.shipment, export_firm=new).first()
            if new_row is None:
                old_row.export_firm = new
                old_row.save(update_fields=['export_firm'])
                reassigned += 1
            else:
                new_row.weight_kg = (new_row.weight_kg or Decimal(0)) + (old_row.weight_kg or Decimal(0))
                new_row.amount_usd = (new_row.amount_usd or Decimal(0)) + (old_row.amount_usd or Decimal(0))
                new_row.save(update_fields=['weight_kg', 'amount_usd'])
                old_row.delete()
                merged += 1
        totals['ShipmentFirmSplit_reassigned'] += reassigned
        totals['ShipmentFirmSplit_merged'] += merged
        self.stdout.write(
            f'    {"export.ShipmentFirmSplit":40}  '
            f'reassigned {reassigned}, merged {merged}')

    def _move_weekly_local_sell_plan(self, old, new, totals: dict) -> None:
        """Unique (export_firm, week_number, year): sum the six day kg columns."""
        old_rows = list(WeeklyLocalSellPlan.objects.filter(export_firm=old))
        if not old_rows:
            return
        reassigned = merged = 0
        day_fields = ['monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
                      'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg']
        for old_row in old_rows:
            new_row = WeeklyLocalSellPlan.objects.filter(
                export_firm=new,
                week_number=old_row.week_number,
                year=old_row.year,
            ).first()
            if new_row is None:
                old_row.export_firm = new
                old_row.save(update_fields=['export_firm'])
                reassigned += 1
            else:
                for f in day_fields:
                    setattr(new_row, f,
                            (getattr(new_row, f) or Decimal(0)) +
                            (getattr(old_row, f) or Decimal(0)))
                new_row.save(update_fields=day_fields)
                old_row.delete()
                merged += 1
        totals['WeeklyLocalSellPlan_reassigned'] += reassigned
        totals['WeeklyLocalSellPlan_merged'] += merged
        self.stdout.write(
            f'    {"export.WeeklyLocalSellPlan":40}  '
            f'reassigned {reassigned}, merged {merged}')

    def _move_quota_issuance_allocation(self, old, new, totals: dict) -> None:
        """Unique (issuance, export_firm): sum kg_quota on conflict."""
        old_rows = list(QuotaIssuanceFirmAllocation.objects.filter(export_firm=old))
        if not old_rows:
            return
        reassigned = merged = 0
        for old_row in old_rows:
            new_row = QuotaIssuanceFirmAllocation.objects.filter(
                issuance=old_row.issuance, export_firm=new).first()
            if new_row is None:
                old_row.export_firm = new
                old_row.save(update_fields=['export_firm'])
                reassigned += 1
            else:
                new_row.kg_quota = (new_row.kg_quota or Decimal(0)) + (old_row.kg_quota or Decimal(0))
                new_row.save(update_fields=['kg_quota'])
                old_row.delete()
                merged += 1
        totals['QuotaIssuanceFirmAllocation_reassigned'] += reassigned
        totals['QuotaIssuanceFirmAllocation_merged'] += merged
        self.stdout.write(
            f'    {"export.QuotaIssuanceFirmAllocation":40}  '
            f'reassigned {reassigned}, merged {merged}')
