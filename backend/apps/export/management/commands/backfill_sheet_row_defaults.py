"""Backfill localized labels/who and role triggers on SheetRowSetting.

For each entry in DEFAULT_SHEET_ROWS:
  * ensure a SheetRowSetting row exists (created on demand using the same
    defaults the data-migration uses — display_order = row_number * 1024);
  * fill any blank label_tk / label_ru / label_en from the i18n JSON via the
    row's ``label_key``;
  * fill any blank who_tk / who_ru / who_en from the i18n JSON via the row's
    ``default_who_key``;
  * if the row has zero SheetRowRoleTrigger rows, seed it with the role(s)
    derived from default_who_key via WHO_TO_ROLE (skips when the mapping
    yields no role — e.g. ``sheet.who.quality``).

Add-only: existing SheetRowRoleTrigger rows are NEVER deleted or modified.
The command is idempotent and safe to re-run.

Usage:
    python manage.py backfill_sheet_row_defaults
    python manage.py backfill_sheet_row_defaults --dry-run
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.export.models import SheetRowSetting, SheetRowRoleTrigger
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS


# Maps the ``default_who_key`` slug (e.g. 'soltanmyrat') to the role(s) that
# should own that row, sourced from docs/DOMAIN.md. Confirmed with the user
# 2026-06-02. 'quality' has no matching role in ROLE_CHOICES and is skipped.
WHO_TO_ROLE: dict[str, list[str]] = {
    'gadam':       ['export_manager'],
    'aganazar':    ['export_manager'],
    'soltanmyrat': ['loading_dept_head'],
    'sirin':       ['document_team'],
    'sulgun':      ['document_team'],
    'arap':        ['sales_rep'],
    'malik':       ['transport'],
    'haltac':      ['transport'],
    'mergen':      ['transport'],
    'babageldi':   ['finansist'],
    'logist':      ['transport'],
    'transport':   ['transport'],
    # 'quality' intentionally omitted — no matching ROLE_CHOICES entry.
}

LANGS = ('tk', 'ru', 'en')


def _i18n_dir() -> Path:
    """Resolve the frontend i18n JSON directory regardless of cwd.

    settings.BASE_DIR points at the Django app (backend/). The frontend lives
    one level above, then frontend/src/i18n.
    """
    return Path(settings.BASE_DIR).parent / 'frontend' / 'src' / 'i18n'


def _load_i18n(lang: str) -> dict[str, Any]:
    """Load a single frontend translation file."""
    path = _i18n_dir() / f'{lang}.json'
    with path.open(encoding='utf-8') as fh:
        return json.load(fh)


def _resolve_key(tree: dict[str, Any], dotted_key: str) -> str | None:
    """Walk a dotted key like 'sheet.row.harvest_block' through a JSON tree."""
    node: Any = tree
    for part in dotted_key.split('.'):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


class Command(BaseCommand):
    help = (
        'Backfill blank labels/who and missing role triggers on SheetRowSetting '
        'using DEFAULT_SHEET_ROWS + frontend i18n JSON. Add-only, idempotent.'
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print every change that would be made without writing to the DB.',
        )

    def handle(self, *args, **options) -> None:
        dry_run: bool = options['dry_run']

        # Validate DEFAULT_SHEET_ROWS shape up front so any malformed entry
        # fails before the transaction opens — a mid-loop KeyError would
        # roll back silently and confuse the operator.
        missing_keys: list[tuple[str, str]] = []
        for row in DEFAULT_SHEET_ROWS:
            for key in ('field_key', 'label_key', 'default_who_key', 'row_number'):
                if key not in row:
                    missing_keys.append((row.get('field_key', '<unknown>'), key))
        if missing_keys:
            for field_key, missing in missing_keys:
                self.stderr.write(self.style.ERROR(
                    f'DEFAULT_SHEET_ROWS entry {field_key!r} is missing key {missing!r}'
                ))
            return

        # Load all three locales up-front; fail fast if a JSON is missing.
        try:
            translations = {lang: _load_i18n(lang) for lang in LANGS}
        except FileNotFoundError as exc:
            self.stderr.write(self.style.ERROR(f'Missing i18n file: {exc}'))
            return

        # Pull every existing SheetRowSetting into memory keyed by field_key so
        # we never query inside the per-row loop.
        existing_by_key: dict[str, SheetRowSetting] = {
            s.field_key: s for s in SheetRowSetting.objects.all()
        }

        # Pre-load triggers for every existing setting, grouped by row_id, so we
        # can tell "has zero triggers" without a query per row.
        triggers_by_row: dict[int, set[str]] = {}
        for trig in SheetRowRoleTrigger.objects.values_list('row_id', 'role'):
            row_id, role = trig
            triggers_by_row.setdefault(row_id, set()).add(role)

        stats = {
            'rows_seen': 0,
            'rows_created': 0,
            'label_fields_filled': 0,
            'who_fields_filled': 0,
            'triggers_added': 0,
            'rows_skipped_quality': 0,
            'rows_already_complete': 0,
        }
        triggers_to_create: list[SheetRowRoleTrigger] = []

        with transaction.atomic():
            for row in DEFAULT_SHEET_ROWS:
                stats['rows_seen'] += 1
                field_key: str = row['field_key']
                label_key: str = row['label_key']
                who_key: str = row['default_who_key']
                row_number: int = row['row_number']

                setting = existing_by_key.get(field_key)
                if setting is None:
                    setting = SheetRowSetting(
                        field_key=field_key,
                        row_number=row_number,
                        display_order=row_number * 1024,
                        is_visible=True,
                    )
                    if not dry_run:
                        setting.save()
                    stats['rows_created'] += 1
                    self.stdout.write(
                        f'  + create SheetRowSetting field_key={field_key}'
                    )

                # --- Labels ---
                label_dirty = False
                for lang in LANGS:
                    attr = f'label_{lang}'
                    if getattr(setting, attr):
                        continue
                    value = _resolve_key(translations[lang], label_key)
                    if value:
                        setattr(setting, attr, value)
                        label_dirty = True
                        stats['label_fields_filled'] += 1
                        self.stdout.write(
                            f'  ~ {field_key} {attr} = "{value}"'
                        )

                # --- Who ---
                who_dirty = False
                for lang in LANGS:
                    attr = f'who_{lang}'
                    if getattr(setting, attr):
                        continue
                    value = _resolve_key(translations[lang], who_key)
                    if value:
                        setattr(setting, attr, value)
                        who_dirty = True
                        stats['who_fields_filled'] += 1
                        self.stdout.write(
                            f'  ~ {field_key} {attr} = "{value}"'
                        )

                if (label_dirty or who_dirty) and not dry_run:
                    # save() bumps version — that's intended; this is a real
                    # admin-visible change.
                    setting.save()

                # --- Role triggers (add-only) ---
                # Map who_key (e.g. 'sheet.who.soltanmyrat') → slug → role list.
                who_slug = who_key.rsplit('.', 1)[-1]
                target_roles = WHO_TO_ROLE.get(who_slug, [])
                if not target_roles:
                    stats['rows_skipped_quality'] += 1
                    continue

                # setting.pk is None when this is a dry-run creation; skip the
                # trigger seeding in that case — the parent row doesn't exist
                # in the DB so an FK insert would fail.
                if setting.pk is None:
                    self.stdout.write(
                        f'  ! {field_key} would seed triggers {target_roles} '
                        f'(skipped — dry-run, no SheetRowSetting row)'
                    )
                    continue

                existing_roles = triggers_by_row.get(setting.pk, set())
                if existing_roles:
                    stats['rows_already_complete'] += 1
                    continue

                for role in target_roles:
                    triggers_to_create.append(
                        SheetRowRoleTrigger(row=setting, role=role)
                    )
                    stats['triggers_added'] += 1
                    self.stdout.write(
                        f'  + {field_key} role_trigger += {role}'
                    )

            if triggers_to_create and not dry_run:
                SheetRowRoleTrigger.objects.bulk_create(
                    triggers_to_create, batch_size=500
                )

            if dry_run:
                # Belt-and-suspenders: every .save() / .bulk_create() above is
                # already guarded by `if not dry_run`, so there should be no
                # pending writes here. The explicit rollback is kept so that
                # a future refactor which adds an un-guarded write still can't
                # accidentally persist during a dry-run.
                transaction.set_rollback(True)

        # Summary
        self.stdout.write('')
        self.stdout.write(
            self.style.SUCCESS(
                'Dry-run complete — nothing written.'
                if dry_run else 'Backfill complete.'
            )
        )
        for key, value in stats.items():
            self.stdout.write(f'  {key:28s} {value}')
