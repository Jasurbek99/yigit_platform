# Firm Letterhead + Letter Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CT-1 / Fito / ARZA request letters print on the seller firm's uploaded Word letterhead, with a per-firm, per-letter-type, per-year outgoing number filled into the letterhead's «№ ___».

**Architecture:** The letterhead is a `.docx` FileField on `core.ExportFirm`. Pure python-docx helpers in `apps/core/letterhead.py` find the «№ ___» blank, which is used both for upload validation (export admin serializer) and for rendering (contracts). Letter numbers are 3 nullable int columns on `ContractSale`. They are allocated by `contracts/services/letter_number.py` against a `LetterNumberBase` floor table, mirroring `invoice_number.py`. `document_render.generate()` post-processes the 3 letter keys: it fills the number and inserts the letterhead body at the top of the rendered letter with `docxcompose`.

**Tech Stack:** Django 5 + DRF, MSSQL (mssql-django), python-docx 1.1, docxtpl 0.19 / docxcompose (already installed), React + TS + antd + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-firm-letterhead-letter-numbers-design.md`

## Global Constraints

- MSSQL: no JSONField, `bulk_create(batch_size=500)`, `CharField(max_length=N)`, `on_delete=models.PROTECT` for reference FKs.
- New columns on existing tables must be `null=True` (beta runs old code on the same DB; memory `feedback_not_null_needs_db_default`).
- Dependency direction `core ← greenhouse ← export ← contracts`. `export/views_admin.py` may import `apps.core.letterhead`, never `apps.contracts.*`.
- Letter keys, exactly: `ct1_ru`, `fito_ru`, `customs_tk`. Letter types, exactly: `ct1`, `fito`, `customs`. Sale fields, exactly: `ct1_number`, `fito_number`, `customs_number`.
- Number format: a bare integer (`№ 15`). The date blank «__» ___ 20 ý. is never filled.
- Without a letterhead on the seller firm, the letter renders byte-for-byte as today. Never fall back to another firm's letterhead.
- Closed-season sales are never written (write freeze D1): no allocation, no manual edit.
- Migrations: before writing one, run `ls backend/apps/<app>/migrations/ | tail -3` and `git log --oneline origin/main -5`. Expected free numbers at plan time: core `0072`, contracts `0017`. Re-check, because other sessions share this tree. After `makemigrations`, run `migrate <app>` and `showmigrations <app>` yourself.
- Tests: use a private DB, so `TEST_DB_NAME=test_letterhead_<task> python manage.py test <label> --noinput` (memory `project_test_db_name_collision`).
- Frontend typecheck: `npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).
- Git: shared tree and shared index. Before every commit run `git status` + `git diff --cached`, and `git add` only this task's paths. Commit only when the user has said "commit". Co-author line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- UI copy never says draft/черновик (memory `feedback_no_draft_word_in_ui`). i18n in en/ru/tk.

## Review Focus

1. **Letterhead whose «№» and underscores sit in different runs** (Word splits runs on any formatting change). Validation and filling must agree. A file that passes upload must get its number filled. Pinned in Task 1 (`test_number_split_across_runs`).
2. **Corrupt or non-docx upload** (like the current `data/Yigit_header.docx` with a broken embedded font). Expect a 400 with a readable message, not a 500. Pinned in Task 1 (`test_corrupt_docx_is_rejected`).
3. **Letterhead file missing or unreadable on disk at render time** (media wiped, moved server). The letter must still download, without a letterhead, and a warning is logged. Pinned in Task 4 (`test_unreadable_letterhead_renders_plain`).
4. **Re-«Привязать» or re-download of an already-numbered sale.** Numbers must not change. Pinned in Task 3 (`test_relink_keeps_numbers`, `test_download_keeps_numbers`).
5. **Manual number equal to its own current value, or taken by the same firm in another year.** Both must be accepted. Taken by the same firm in the same year with the same type → 400. Pinned in Task 5 (`test_same_value_is_ok`, `test_other_year_is_ok`).

---

### Task 1: Letterhead helpers + `ExportFirm.letterhead` + upload validation

**Files:**
- Create: `backend/apps/core/letterhead.py`
- Modify: `backend/apps/core/models/firms.py` (after `director_stamp`, ~L48)
- Create: `backend/apps/core/migrations/0072_exportfirm_letterhead.py` (via makemigrations)
- Modify: `backend/apps/export/views_admin.py` (`ExportFirmSerializer`, ~L215-240)
- Test: `backend/apps/core/tests_letterhead.py`

**Interfaces:**
- Produces:
  - `apps.core.letterhead.number_blank_run(doc: docx.document.Document) -> docx.text.run.Run | None`: the run holding the first `_{3,}` at or after the first `№` in a body paragraph.
  - `apps.core.letterhead.fill_number(doc, number: int | None) -> None`: replaces that underscore run with `str(number)`. With `None` or no blank found, it does nothing.
  - `apps.core.letterhead.validate_letterhead(fileobj) -> None`: raises `ValueError(<message>)`.
  - `ExportFirm.letterhead` FileField. The API field is `letterhead` (root-relative URL or null).

- [ ] **Step 1: Write failing tests**

```python
"""Letterhead helpers: find/fill the «№ ___» blank, validate uploads (spec 2026-10-05)."""
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from docx import Document
from rest_framework.test import APIClient

from apps.core.letterhead import fill_number, number_blank_run, validate_letterhead
from apps.core.models import ExportFirm, User


def letterhead_bytes(*runs: str) -> bytes:
    """A docx whose one body paragraph is made of the given runs."""
    doc = Document()
    doc.add_paragraph('ÝIGIT HOJALYK JEMGYÝETI')
    para = doc.add_paragraph()
    for text in runs:
        para.add_run(text)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _doc(data: bytes):
    return Document(BytesIO(data))


class NumberBlankTest(SimpleTestCase):
    def test_finds_blank_in_one_run(self):
        doc = _doc(letterhead_bytes('«____» ______ 20 ý.', '    № ___________ '))
        self.assertIn('___', number_blank_run(doc).text)

    def test_number_split_across_runs(self):
        doc = _doc(letterhead_bytes('№', ' ', '__________'))
        fill_number(doc, 15)
        self.assertIn('№ 15', doc.paragraphs[1].text)

    def test_date_underscores_before_number_sign_are_left(self):
        doc = _doc(letterhead_bytes('«____» ______ 20 ý.', '    № ___________ '))
        fill_number(doc, 7)
        text = doc.paragraphs[1].text
        self.assertTrue(text.startswith('«____» ______ 20 ý.'))
        self.assertIn('№ 7', text)

    def test_no_number_sign_means_no_blank(self):
        self.assertIsNone(number_blank_run(_doc(letterhead_bytes('«____» ______ 20 ý.'))))

    def test_none_number_leaves_the_blank(self):
        doc = _doc(letterhead_bytes('№ _____'))
        fill_number(doc, None)
        self.assertIn('№ _____', doc.paragraphs[1].text)


class ValidateLetterheadTest(SimpleTestCase):
    def test_valid_file_passes(self):
        validate_letterhead(BytesIO(letterhead_bytes('№ _____')))

    def test_missing_blank_is_rejected(self):
        with self.assertRaisesMessage(ValueError, '№'):
            validate_letterhead(BytesIO(letterhead_bytes('no blank here')))

    def test_corrupt_docx_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_letterhead(BytesIO(b'PK\x03\x04 not really a zip'))


class LetterheadUploadApiTest(TestCase):
    def setUp(self):
        self.firm = ExportFirm.objects.create(code='LHUP', name_tk='LH', name_short='LH')
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create(username='lh_admin', role='admin'))
        self.url = f'/api/v1/export/admin/firms/{self.firm.id}/'

    def _upload(self, data: bytes, name='blank.docx'):
        return self.client.patch(
            self.url, {'letterhead': SimpleUploadedFile(name, data)}, format='multipart',
        )

    def test_valid_upload_is_saved(self):
        resp = self._upload(letterhead_bytes('№ _____'))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()['letterhead'].startswith('/media/export_firms/letterheads/'))

    def test_bad_upload_is_400(self):
        resp = self._upload(letterhead_bytes('nothing'))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('letterhead', resp.json())

    def test_non_docx_name_is_400(self):
        self.assertEqual(self._upload(letterhead_bytes('№ ___'), name='blank.pdf').status_code, 400)
```

Check `ExportFirm.objects.create` required fields against `core/models/firms.py` and add any non-null ones the model needs.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd backend && TEST_DB_NAME=test_letterhead_t1 venv/Scripts/python manage.py test apps.core.tests_letterhead --noinput`
Expected: ImportError `apps.core.letterhead`.

- [ ] **Step 3: Implement `backend/apps/core/letterhead.py`**

```python
"""Firm letterhead (.docx) helpers — the «№ ___» blank (spec 2026-10-05).

Pure python-docx, no Django: export's admin serializer validates uploads with
it and contracts' renderer fills the number with it, so both agree on what
counts as the blank.
"""
from __future__ import annotations

import re
import zipfile

from docx import Document

NUMBER_SIGN = '№'
_BLANK = re.compile(r'_{3,}')

MISSING_BLANK_MESSAGE = 'В бланке не найдено «№ ___» — поставьте № и подчёркивания там, где печатать номер.'
UNREADABLE_MESSAGE = (
    'Файл бланка не открывается. Пересохраните его в Word как .docx '
    '(без внедрения шрифтов) и загрузите снова.'
)


def number_blank_run(doc):
    """The run holding the first ``___`` at/after the first ``№`` of a body paragraph."""
    for paragraph in doc.paragraphs:
        seen_sign = False
        for run in paragraph.runs:
            text = run.text
            if not seen_sign:
                idx = text.find(NUMBER_SIGN)
                if idx < 0:
                    continue
                seen_sign = True
                text = text[idx + 1:]
            if _BLANK.search(text):
                return run
    return None


def fill_number(doc, number: int | None) -> None:
    """Put ``number`` in place of the blank's underscores (after the ``№``)."""
    if number is None:
        return
    run = number_blank_run(doc)
    if run is None:
        return
    idx = run.text.find(NUMBER_SIGN)
    head, tail = (run.text[:idx + 1], run.text[idx + 1:]) if idx >= 0 else ('', run.text)
    run.text = head + _BLANK.sub(str(number), tail, count=1)


def validate_letterhead(fileobj) -> None:
    """Raise ``ValueError`` unless ``fileobj`` is a readable .docx with a «№ ___»."""
    try:
        doc = Document(fileobj)
    except (zipfile.BadZipFile, KeyError, ValueError, OSError, Exception) as exc:  # noqa: BLE001
        # python-docx surfaces a damaged part as zlib.error / BadZipFile / KeyError;
        # any of them means the office cannot use this file.
        raise ValueError(UNREADABLE_MESSAGE) from exc
    if number_blank_run(doc) is None:
        raise ValueError(MISSING_BLANK_MESSAGE)
```

Narrow the `except` to the exceptions actually seen. Try a truncated zip, a non-zip, and the real broken `data/Yigit_header.docx` (it raises `zlib.error`). Then list those types instead of `Exception`.

- [ ] **Step 4: Add the model field** in `core/models/firms.py` under `director_stamp`:

```python
    # Firm letterhead (.docx) — inserted at the top of the CT-1 / Fito / ARZA
    # request letters, its «№ ___» filled with the letter number. Replaced, not
    # versioned. See apps/core/letterhead.py (spec 2026-10-05).
    letterhead = models.FileField(upload_to='export_firms/letterheads/', null=True, blank=True)
```

Run: `venv/Scripts/python manage.py makemigrations core -n exportfirm_letterhead`. Check the number is the free one, then `migrate core` and `showmigrations core | tail -3`.

- [ ] **Step 5: Serializer** in `export/views_admin.py` `ExportFirmSerializer`: add `letterhead = RelativeFileField(required=False, allow_null=True)`, add `'letterhead'` to `Meta.fields` after `'director_stamp'`, and:

```python
    def validate_letterhead(self, value):
        if not value:
            return value
        if not value.name.lower().endswith('.docx'):
            raise serializers.ValidationError('Бланк должен быть файлом .docx.')
        try:
            validate_letterhead(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        value.seek(0)
        return value
```

Import it as `from apps.core.letterhead import validate_letterhead`. The method name shadows it, so import it as `validate_letterhead as check_letterhead` and call `check_letterhead(value)`.

- [ ] **Step 6: Run tests, expect PASS** (same command as Step 2).

- [ ] **Step 7: Commit (on user instruction)**

```bash
git add backend/apps/core/letterhead.py backend/apps/core/models/firms.py backend/apps/core/migrations/0072_exportfirm_letterhead.py backend/apps/export/views_admin.py backend/apps/core/tests_letterhead.py
git commit -m "feat(core): export firm letterhead upload with «№ ___» check"
```

---

### Task 2: Letter number columns, floor table, allocation service

**Files:**
- Create: `backend/apps/contracts/models/letter_number_base.py`
- Modify: `backend/apps/contracts/models/__init__.py` (re-export `LetterNumberBase`)
- Modify: `backend/apps/contracts/models/contract_sale.py` (after `invoice_printed_at`, ~L77)
- Create: `backend/apps/contracts/migrations/0017_letter_numbers.py` (via makemigrations)
- Create: `backend/apps/contracts/services/letter_number.py`
- Test: `backend/apps/contracts/tests/test_letter_number.py`

**Interfaces:**
- Produces:
  - `LetterNumberBase(export_firm FK, letter_type str, year int, last_number int, updated_at, updated_by)`, with `LETTER_TYPES = ('ct1', 'fito', 'customs')`.
  - `ContractSale.ct1_number / fito_number / customs_number: int | None`.
  - `letter_number.SALE_FIELD: dict[str, str] = {'ct1': 'ct1_number', 'fito': 'fito_number', 'customs': 'customs_number'}`
  - `letter_number.LETTER_TYPE_FOR_KEY: dict[str, str] = {'ct1_ru': 'ct1', 'fito_ru': 'fito', 'customs_tk': 'customs'}`
  - `letter_number.letter_year(sale) -> int`: `invoice_date.year`, else `shipment.date.year`, else today.
  - `letter_number.allocate_letter_number(export_firm_id: int, letter_type: str, year: int) -> int`, called inside `transaction.atomic`.
  - `letter_number.ensure_letter_numbers(sale: ContractSale) -> ContractSale`, `@transaction.atomic`. It fills only the empty fields and never writes a closed-season sale.
  - `letter_number.number_taken(sale, letter_type: str, number: int) -> bool`, used by Task 5.

- [ ] **Step 1: Failing tests** `apps/contracts/tests/test_letter_number.py`:

```python
"""Letter numbers per export firm × letter type × year (spec 2026-10-05)."""
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.contracts.models import ContractSale, LetterNumberBase
from apps.contracts.services.letter_number import (
    allocate_letter_number, ensure_letter_numbers, letter_year, number_taken,
)
from apps.contracts.tests.test_contract_sale_api import (
    _make_contract, _make_export_firm, _make_import_firm, _make_season,
)
from apps.contracts.tests.test_document_generation import _make_packed_shipment


def _sale(contract, date, shipment=None, **numbers) -> ContractSale:
    sale = ContractSale.objects.create(
        contract=contract, invoice_date=date, total_usd=Decimal('100.00'),
        shipment=shipment, **numbers,
    )
    sale.refresh_from_db()
    return sale


class AllocateLetterNumberTest(TestCase):
    def setUp(self):
        season = _make_season()
        imp = _make_import_firm('IMPLTR')
        self.dm = _make_export_firm('DMLTR')
        self.ma = _make_export_firm('MALTR')
        self.c_dm = _make_contract('LTR-DM', self.dm, imp, season)
        self.c_ma = _make_contract('LTR-MA', self.ma, imp, season)

    def test_no_floor_starts_at_one(self):
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 1)

    def test_starts_above_floor(self):
        LetterNumberBase.objects.create(export_firm=self.dm, letter_type='fito', year=2026, last_number=40)
        self.assertEqual(allocate_letter_number(self.dm.id, 'fito', 2026), 41)

    def test_types_count_separately(self):
        _sale(self.c_dm, '2026-10-01', ct1_number=1)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 2)
        self.assertEqual(allocate_letter_number(self.dm.id, 'customs', 2026), 1)

    def test_firms_count_separately(self):
        _sale(self.c_dm, '2026-10-01', fito_number=1)
        self.assertEqual(allocate_letter_number(self.ma.id, 'fito', 2026), 1)

    def test_new_year_restarts(self):
        _sale(self.c_dm, '2026-12-30', ct1_number=5)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2027), 1)

    def test_reuses_freed_gap(self):
        _sale(self.c_dm, '2026-10-01', ct1_number=1)
        _sale(self.c_dm, '2026-10-02', ct1_number=3)
        self.assertEqual(allocate_letter_number(self.dm.id, 'ct1', 2026), 2)

    def test_locks_floor_row(self):
        with mock.patch.object(
            LetterNumberBase.objects, 'select_for_update',
            wraps=LetterNumberBase.objects.select_for_update,
        ) as spy:
            allocate_letter_number(self.dm.id, 'ct1', 2026)
        spy.assert_called_once_with()

    def test_number_taken(self):
        sale = _sale(self.c_dm, '2026-10-01', ct1_number=4)
        other = _sale(self.c_dm, '2026-10-02')
        self.assertTrue(number_taken(other, 'ct1', 4))
        self.assertFalse(number_taken(sale, 'ct1', 4))   # its own number
        self.assertFalse(number_taken(other, 'fito', 4))


class EnsureLetterNumbersTest(TestCase):
    def setUp(self):
        self.season = _make_season()
        imp = _make_import_firm('IMPLTE')
        self.firm = _make_export_firm('LTEFIRM')
        self.contract = _make_contract('LTE-1', self.firm, imp, self.season)
        self.shipment = _make_packed_shipment(self.season, imp, code='0505001/25')
        self.shipment.refresh_from_db()

    def test_fills_all_three(self):
        sale = ensure_letter_numbers(_sale(self.contract, None, shipment=self.shipment))
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, sale.fito_number, sale.customs_number), (1, 1, 1))

    def test_year_falls_back_to_truck_date(self):
        sale = _sale(self.contract, None, shipment=self.shipment)
        self.assertEqual(letter_year(sale), 2025)

    def test_keeps_existing_and_fills_missing(self):
        sale = ensure_letter_numbers(_sale(self.contract, '2026-01-05', ct1_number=9))
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, sale.fito_number), (9, 1))

    def test_closed_season_left_alone(self):
        type(self.season).objects.filter(pk=self.season.pk).update(closed_at=timezone.now())
        sale = _sale(self.contract, None, shipment=self.shipment)
        ensure_letter_numbers(ContractSale.objects.get(pk=sale.pk))
        sale.refresh_from_db()
        self.assertIsNone(sale.ct1_number)
```

- [ ] **Step 2: Run, expect FAIL** (ImportError): `TEST_DB_NAME=test_letterhead_t2 venv/Scripts/python manage.py test apps.contracts.tests.test_letter_number --noinput`

- [ ] **Step 3: Model** `contracts/models/letter_number_base.py`:

```python
"""LetterNumberBase — per-firm, per-letter-type, per-year floor for request-letter numbers.

CT-1 / Fito / ARZA letters are numbered per export firm, per letter type, within
a calendar year, restarting at 1 each January. An admin records the last number
each firm used outside the system; allocation starts above it. No row = floor 0.
See docs/superpowers/specs/2026-10-05-firm-letterhead-letter-numbers-design.md.
"""
from django.conf import settings
from django.db import models

from apps.core.db_utils import schema_table

LETTER_TYPES = ('ct1', 'fito', 'customs')


class LetterNumberBase(models.Model):
    LETTER_TYPE_CHOICES = [(t, t) for t in LETTER_TYPES]

    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT, related_name='letter_number_bases',
    )
    letter_type = models.CharField(max_length=10, choices=LETTER_TYPE_CHOICES)
    year = models.IntegerField()
    last_number = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='+',
    )

    class Meta:
        db_table = schema_table('contracts', 'letter_number_base')
        constraints = [
            models.UniqueConstraint(
                fields=['export_firm', 'letter_type', 'year'], name='uq_letter_base_firm_type_year',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.export_firm_id}/{self.letter_type}/{self.year}: {self.last_number}'
```

In `models/__init__.py` add `from .letter_number_base import LetterNumberBase` and add `'LetterNumberBase'` to `__all__`.

In `contract_sale.py` after `invoice_printed_at`:

```python
    # Outgoing numbers of the CT-1 / Fito / ARZA request letters — per export firm,
    # per letter type, per year; see services/letter_number.py (spec 2026-10-05).
    ct1_number = models.IntegerField(null=True, blank=True)
    fito_number = models.IntegerField(null=True, blank=True)
    customs_number = models.IntegerField(null=True, blank=True)
```

Run `makemigrations contracts -n letter_numbers`, check the number, then `migrate contracts` and `showmigrations contracts | tail -3`.

- [ ] **Step 4: Service** `contracts/services/letter_number.py`:

```python
"""Request-letter numbers — per export firm × letter type × calendar year (spec 2026-10-05).

Same rule as invoice numbers (services/invoice_number.py): the smallest number
above the admin floor that no sale of that firm/year holds in that letter's field,
so a freed number is reused.
"""
from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.contracts.models import ContractSale, LetterNumberBase
from apps.core.seasons import freeze_season_of

SALE_FIELD = {'ct1': 'ct1_number', 'fito': 'fito_number', 'customs': 'customs_number'}
LETTER_TYPE_FOR_KEY = {'ct1_ru': 'ct1', 'fito_ru': 'fito', 'customs_tk': 'customs'}


def letter_year(sale: ContractSale) -> int:
    """The numbering year: invoice date, else the truck's date, else today."""
    if sale.invoice_date is not None:
        return sale.invoice_date.year
    if sale.shipment_id and sale.shipment.date is not None:
        return sale.shipment.date.year
    return timezone.localdate().year


def _firm_year_sales(export_firm_id: int, year: int):
    """A firm's sales in a numbering year. An undated sale counts in its truck's year,
    the same fallback letter_year uses, so its number is seen as taken."""
    return ContractSale.objects.filter(
        Q(invoice_date__year=year) | Q(invoice_date__isnull=True, shipment__date__year=year),
        contract__export_firm_id=export_firm_id,
    ).order_by()


def allocate_letter_number(export_firm_id: int, letter_type: str, year: int) -> int:
    """Next free number; locks the floor row so concurrent callers serialize."""
    base, _ = LetterNumberBase.objects.get_or_create(
        export_firm_id=export_firm_id, letter_type=letter_type, year=year,
    )
    base = LetterNumberBase.objects.select_for_update().get(pk=base.pk)
    field = SALE_FIELD[letter_type]
    used = set(
        _firm_year_sales(export_firm_id, year)
        .filter(**{f'{field}__gt': base.last_number})
        .values_list(field, flat=True)
    )
    number = base.last_number + 1
    while number in used:
        number += 1
    return number


def number_taken(sale: ContractSale, letter_type: str, number: int) -> bool:
    """Whether another sale of the same firm and year holds ``number`` for this letter."""
    return (
        _firm_year_sales(sale.contract.export_firm_id, letter_year(sale))
        .filter(**{SALE_FIELD[letter_type]: number})
        .exclude(pk=sale.pk)
        .exists()
    )


@transaction.atomic
def ensure_letter_numbers(sale: ContractSale) -> ContractSale:
    """Fill whichever of the three letter numbers the sale lacks. Closed season → untouched."""
    missing = [t for t, f in SALE_FIELD.items() if getattr(sale, f) is None]
    if not missing:
        return sale
    season = freeze_season_of(sale)
    if season is not None and season.is_closed:
        return sale
    year = letter_year(sale)
    firm_id = sale.contract.export_firm_id
    for letter_type in missing:
        setattr(sale, SALE_FIELD[letter_type], allocate_letter_number(firm_id, letter_type, year))
    sale.save(update_fields=[SALE_FIELD[t] for t in missing] + ['updated_at'])
    return sale
```

Add `from django.db.models import Q` to the imports. Add the test `test_undated_sale_counts_by_truck_year`: a sale with no invoice_date and `ct1_number=1`, on a 2025 truck, means the next 2025 allocation is 2.

`sale.save(update_fields=...)` runs `ContractSale.save()` → `rollup_contract_totals()`. That is harmless but costs a query. Keep it: the invoice service does the same.

- [ ] **Step 5: Run, expect PASS.**

- [ ] **Step 6: Commit (on user instruction)**

```bash
git add backend/apps/contracts/models/letter_number_base.py backend/apps/contracts/models/__init__.py backend/apps/contracts/models/contract_sale.py backend/apps/contracts/migrations/0017_letter_numbers.py backend/apps/contracts/services/letter_number.py backend/apps/contracts/tests/test_letter_number.py
git commit -m "feat(p4): request-letter numbers per firm, letter type and year"
```

---

### Task 3: Allocate at «Привязать», manual sale, and download

**Files:**
- Modify: `backend/apps/contracts/services/shipment_firm_contracts.py` (`link_split_to_contract`, end, ~L248)
- Modify: `backend/apps/contracts/serializers.py` (`ContractSaleCreateSerializer.create`, ~L576)
- Modify: `backend/apps/contracts/views.py` (`ContractSaleViewSet.document` ~L484, `ShipmentPacketZipView.get` ~L760)
- Test: `backend/apps/contracts/tests/test_letter_number.py` (new class `LetterNumberWiringTest`)

**Interfaces:**
- Consumes: `ensure_letter_numbers`, `LETTER_TYPE_FOR_KEY` (Task 2).

- [ ] **Step 1: Failing tests.** Reuse the setup of the existing link/document tests. Read `apps/contracts/tests/test_shipment_firm_contracts.py` for how a split + framework contract is set up for `link_split_to_contract`, and `test_document_generation.py` ~L1501 (`test_ct1_letter_type`) for the document endpoint call. Write:

```python
class LetterNumberWiringTest(TestCase):
    # setUp: copy the fixture of test_document_generation's CT-1 endpoint test
    # (season, import firm, export firm, contract, packed shipment, firm split,
    # sale with complete packing) and an authenticated admin APIClient.

    def test_link_numbers_all_three(self):
        sale = link_split_to_contract(shipment=self.shipment, export_firm_id=self.firm.id,
                                      mode='framework', contract_id=self.contract.id, user=self.user)
        sale.refresh_from_db()
        self.assertEqual((sale.ct1_number, sale.fito_number, sale.customs_number), (1, 1, 1))

    def test_relink_keeps_numbers(self):
        args = dict(shipment=self.shipment, export_firm_id=self.firm.id,
                    mode='framework', contract_id=self.contract.id, user=self.user)
        link_split_to_contract(**args)
        sale = link_split_to_contract(**args)
        sale.refresh_from_db()
        self.assertEqual(sale.ct1_number, 1)

    def test_download_numbers_a_bare_sale(self):
        resp = self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/', {'type': 'fito_ru'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.fito_number, 1)

    def test_download_keeps_numbers(self):
        ContractSale.objects.filter(pk=self.sale.pk).update(fito_number=12)
        self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/', {'type': 'fito_ru'})
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.fito_number, 12)

    def test_invoice_download_does_not_number_letters(self):
        self.client.get(f'/api/v1/contracts/sales/{self.sale.id}/document/',
                        {'type': 'invoice_ru', 'place_loading': 'X'})
        self.sale.refresh_from_db()
        self.assertIsNone(self.sale.ct1_number)

    def test_packet_zip_numbers_every_sale(self):
        resp = self.client.get(f'/api/v1/contracts/shipments/{self.shipment.id}/packet.zip',
                               {'place_loading': 'X'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.sale.refresh_from_db()
        self.assertIsNotNone(self.sale.customs_number)
```

Add a manual-create test to the existing `test_contract_sale_api.py` style: POST a sale → `ct1_number == 1`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Wire it.**

`link_split_to_contract`, just before `return sale`:

```python
    ensure_letter_numbers(sale)
```

(import `from apps.contracts.services.letter_number import ensure_letter_numbers`). `link_split_to_contract` is already `@transaction.atomic`.

`ContractSaleCreateSerializer.create`, before `return sale`:

```python
        ensure_letter_numbers(sale)
```

`ContractSaleViewSet.document`, after the place-loading guard and before `generate(...)`:

```python
        if doc_type in LETTER_TYPE_FOR_KEY:
            invoice = ensure_letter_numbers(invoice)
```

`ShipmentPacketZipView.get`, after `active_sales` is built and before `generate_packet_zip`:

```python
        active_sales = [ensure_letter_numbers(s) for s in active_sales]
```

`ensure_letter_numbers` returns the same instance, so the prefetched relations on it stay valid.

- [ ] **Step 4: Run new tests + `apps.contracts` suite, expect PASS.** Note any pre-existing failures (memory `project_beta_test_suite_failures`) and show they also fail on `HEAD` without this change.

- [ ] **Step 5: Commit (on user instruction)**

```bash
git add backend/apps/contracts/services/shipment_firm_contracts.py backend/apps/contracts/serializers.py backend/apps/contracts/views.py backend/apps/contracts/tests/test_letter_number.py backend/apps/contracts/tests/test_contract_sale_api.py
git commit -m "feat(p4): number the request letters at link, manual sale and download"
```

---

### Task 4: Render letters on the firm letterhead

**Files:**
- Create: `backend/apps/contracts/services/letterhead_render.py`
- Modify: `backend/apps/contracts/services/document_render.py` (`generate`, ~L424-428)
- Test: `backend/apps/contracts/tests/test_letterhead_render.py`

**Interfaces:**
- Consumes: `apps.core.letterhead.fill_number` (Task 1), `LETTER_TYPE_FOR_KEY`, `SALE_FIELD` (Task 2), `ExportFirm.letterhead` (Task 1).
- Produces: `letterhead_render.apply_letterhead(letter_bytes: bytes, letterhead_bytes: bytes, number: int | None) -> bytes` and `letterhead_render.letterhead_for(sale) -> bytes | None` (the seller's file bytes; `None` when there is no file or it is unreadable).

- [ ] **Step 1: Failing tests**

```python
"""CT-1 / Fito / ARZA on the seller's letterhead (spec 2026-10-05 §5)."""
from io import BytesIO

from django.core.files.base import ContentFile
from django.test import TestCase
from docx import Document

from apps.contracts.services.document_render import generate
from apps.contracts.services.letterhead_render import apply_letterhead
from apps.core.tests_letterhead import letterhead_bytes
# + the packed-sale fixture helpers used in Task 3


def _text(docx_bytes: bytes) -> str:
    return '\n'.join(p.text for p in Document(BytesIO(docx_bytes)).paragraphs)


class ApplyLetterheadTest(TestCase):
    def _letter(self) -> bytes:
        doc = Document()
        doc.add_paragraph('Гос служба по карантину')
        buf = BytesIO(); doc.save(buf)
        return buf.getvalue()

    def test_letterhead_goes_on_top_with_number(self):
        out = apply_letterhead(self._letter(), letterhead_bytes('ÝIGIT', ' № ______'), 15)
        text = _text(out)
        self.assertLess(text.index('ÝIGIT'), text.index('Гос служба'))
        self.assertIn('№ 15', text)

    def test_letter_keeps_its_last_section_margins(self):
        letter = Document(BytesIO(self._letter()))
        want = letter.sections[-1].left_margin
        out = Document(BytesIO(apply_letterhead(self._letter(), letterhead_bytes('№ ___'), 1)))
        self.assertEqual(out.sections[-1].left_margin, want)


class GenerateWithLetterheadTest(TestCase):
    # setUp: packed sale fixture (Task 3) with self.firm = the sale's contract.export_firm.

    def test_no_letterhead_is_unchanged(self):
        before, _, _ = generate('ct1_ru', self.sale, 'docx', {}, highlight=False)
        self.assertNotIn('ÝIGIT', _text(before))

    def test_with_letterhead_and_number(self):
        self.firm.letterhead.save('lh.docx', ContentFile(letterhead_bytes('ÝIGIT', '№ ____')))
        self.sale.ct1_number = 7
        self.sale.save(update_fields=['ct1_number'])
        data, _, _ = generate('ct1_ru', self.sale, 'docx', {}, highlight=False)
        self.assertIn('№ 7', _text(data))

    def test_other_firms_letterhead_never_used(self):
        other = _make_export_firm('OTHERLH')
        other.letterhead.save('lh.docx', ContentFile(letterhead_bytes('OTHERHEAD', '№ ____')))
        data, _, _ = generate('fito_ru', self.sale, 'docx', {}, highlight=False)
        self.assertNotIn('OTHERHEAD', _text(data))

    def test_invoice_never_gets_letterhead(self):
        self.firm.letterhead.save('lh.docx', ContentFile(letterhead_bytes('ÝIGIT', '№ ____')))
        data, _, _ = generate('invoice_ru', self.sale, 'docx', {'place_loading': 'X'}, highlight=False)
        self.assertNotIn('ÝIGIT', _text(data))

    def test_unreadable_letterhead_renders_plain(self):
        self.firm.letterhead.save('lh.docx', ContentFile(b'broken'))
        with self.assertLogs('apps.contracts.services.letterhead_render', 'WARNING'):
            data, _, _ = generate('customs_tk', self.sale, 'docx', {}, highlight=False)
        self.assertNotIn('ÝIGIT', _text(data))
```

Use `override_settings(MEDIA_ROOT=<tempdir>)` on the test classes that save files, so the test run writes nothing to the real media folder.

Add a PDF smoke test that is skipped when LibreOffice is unavailable. Copy the existing skip guard from `test_document_generation.py` (grep `skipUnless` / `LIBREOFFICE`). Render all 3 letters with the fixture letterhead as PDF and assert `fitz.open(stream=…).page_count == 1`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `letterhead_render.py`**

```python
"""Put a request letter on the seller's letterhead (spec 2026-10-05 §5).

The rendered letter stays the master document, so its fonts, margins and saved
layout survive. The letterhead body is inserted at the top. Before insertion the
letterhead's paragraph spacing, which it inherits from its own styles, is written
onto each of its paragraphs: once merged, its paragraphs would otherwise take the
letter's Normal spacing (found in the 2026-10-05 prototype: ARZA spilled onto a
second page).
"""
from __future__ import annotations

import logging
from io import BytesIO

from docx import Document
from docx.oxml.ns import qn
from docxcompose.composer import Composer

from apps.core.letterhead import fill_number

logger = logging.getLogger(__name__)


_SPACING_ATTRS = ('before', 'after', 'line', 'lineRule')
# Word's built-in values when nothing in the chain sets an attribute.
_SPACING_BUILTIN = {'before': '0', 'after': '0', 'line': '240', 'lineRule': 'auto'}


def _ppr_chain(doc, paragraph) -> list:
    """pPr elements a paragraph inherits from: its style chain, then docDefaults."""
    chain, style = [], paragraph.style
    while style is not None:
        chain.append(style.element.pPr)
        style = style.base_style
    defaults = doc.styles.element.find(qn('w:docDefaults'))
    if defaults is not None:
        chain.append(defaults.find(qn('w:pPrDefault') + '/' + qn('w:pPr')))
    return [p for p in chain if p is not None]


def _freeze_spacing(doc) -> None:
    """Write every spacing attribute onto each letterhead paragraph explicitly.

    OOXML inherits w:spacing PER ATTRIBUTE, so copying one inherited element is not
    enough: a missing ``line`` would still come from the letter's Normal after the
    merge. Each attribute resolves on its own: the paragraph's own value, then the
    style chain, then docDefaults, then Word's built-in.
    """
    for paragraph in doc.paragraphs:
        ppr = paragraph._p.get_or_add_pPr()
        own = ppr.find(qn('w:spacing'))
        values = {a: (own.get(qn(f'w:{a}')) if own is not None else None) for a in _SPACING_ATTRS}
        for source in _ppr_chain(doc, paragraph):
            spacing = source.find(qn('w:spacing'))
            if spacing is None:
                continue
            for attr in _SPACING_ATTRS:
                if values[attr] is None:
                    values[attr] = spacing.get(qn(f'w:{attr}'))
        if own is None:
            own = ppr._insert_spacing(ppr.makeelement(qn('w:spacing'), {}))  # schema order
        for attr in _SPACING_ATTRS:
            own.set(qn(f'w:{attr}'), values[attr] or _SPACING_BUILTIN[attr])


def _freeze_run_fonts(doc) -> None:
    """Same per-attribute freeze for run font face (w:rFonts) and size (w:sz).

    The Yigit blank sets fonts directly on its runs, so it does not need this.
    A blank that relies on its styles for font or size would otherwise print in
    the letter's font. Resolve each run's rFonts/sz through: the run's own rPr →
    its character style chain → the paragraph style's rPr chain → docDefaults
    rPrDefault. Write the resolved values onto the run's rPr
    (``run._r.get_or_add_rPr()``, then ``rPr._insert_rFonts`` / ``rPr._insert_sz``
    for schema order). For rFonts, copy the ascii/hAnsi/cs/eastAsia attributes
    and drop theme-font attributes (asciiTheme etc.), because the letter's theme
    differs from the blank's.
    """
    ...  # implement as described; test: test_style_font_survives_merge


def _trim_trailing_empty_paragraphs(doc) -> None:
    """Drop empty paragraphs at the very end of the body (before the final sectPr).

    The merged ARZA ran exactly one empty trailing paragraph onto a blank page 2
    (prototype 2026-10-05). Stop at the first paragraph that has text, a drawing
    or a sectPr. Never remove the paragraph right after a table: Word needs one there.
    """
    body = doc.element.body
    while True:
        children = [e for e in body if e.tag != qn('w:sectPr')]
        if len(children) < 2 or children[-1].tag != qn('w:p'):
            return
        last, before = children[-1], children[-2]
        if (''.join(last.itertext()).strip()
                or last.find('.//' + qn('w:sectPr')) is not None
                or last.find('.//' + qn('w:drawing')) is not None
                or before.tag == qn('w:tbl')):
            return
        body.remove(last)


def apply_letterhead(letter_bytes: bytes, letterhead_bytes: bytes, number: int | None) -> bytes:
    head = Document(BytesIO(letterhead_bytes))
    fill_number(head, number)
    _freeze_spacing(head)
    _freeze_run_fonts(head)
    composer = Composer(Document(BytesIO(letter_bytes)))
    composer.insert(0, head)
    merged = composer.doc
    _trim_trailing_empty_paragraphs(merged)
    buf = BytesIO()
    merged.save(buf)
    return buf.getvalue()


def letterhead_for(sale) -> bytes | None:
    """The seller firm's letterhead bytes, or None (no file / unreadable → plain letter)."""
    contract = sale.contract
    firm = sale.export_firm or (contract.export_firm if contract else None)
    field = getattr(firm, 'letterhead', None)
    if not field or not getattr(field, 'name', ''):
        return None
    try:
        field.open('rb')
        try:
            data = field.read()
        finally:
            field.close()
        Document(BytesIO(data))  # unreadable → warn and fall back below
    except Exception:  # noqa: BLE001 — a bad stored file must not fail the document
        logger.warning('letterhead unreadable for firm %s: %s', getattr(firm, 'pk', '?'), field.name)
        return None
    return data
```

Narrow both broad `except`s to the exception types Task 1 found. `_freeze_spacing` above was prototyped on the real Yigit blank (2026-10-05, `scratchpad/proto3.py`): the header matched Word, and with the trailing-paragraph trim all 3 letters were 1 page. The merged letter section's `start_type` was CONTINUOUS. `_freeze_run_fonts` was not prototyped. Implement it from its docstring and pin it with `test_style_font_survives_merge`: a letterhead whose Normal style sets `Arial`/`sz=16` and whose runs set nothing, merged into a Times letter, keeps Arial 8pt on the header runs.

Add these tests to `ApplyLetterheadTest`:
- `test_letter_section_is_continuous`: `Document(out).sections[-1].start_type == WD_SECTION.CONTINUOUS`. The office opens the .docx in Word, which honours a nextPage break that LibreOffice may not.
- `test_spacing_frozen_per_attribute`: the letterhead Normal sets only `after=0`, and the letter Normal sets `line=360`. The header paragraph ends up with `line='240'`, not 360.
- `test_trailing_empty_paragraph_trimmed` and `test_paragraph_after_table_kept`.

Seller resolution must match the builders (`invoice.export_firm or contract.export_firm`, see `build_ct1_context`).

- [ ] **Step 4: Hook into `generate`** (`document_render.py`). In the `else:` docx branch after `render_docx(...)`:

```python
        letter_type = LETTER_TYPE_FOR_KEY.get(document_key)
        if letter_type is not None:
            head = letterhead_render.letterhead_for(primary_obj)
            if head is not None:
                number = getattr(primary_obj, SALE_FIELD[letter_type])
                source_bytes = letterhead_render.apply_letterhead(source_bytes, head, number)
```

Imports: `from apps.contracts.services import letterhead_render` and `from apps.contracts.services.letter_number import LETTER_TYPE_FOR_KEY, SALE_FIELD`. Watch for a cycle: `letter_number` imports `models` only, which is fine.

`generate_packet_zip` calls `generate`, so the packet is covered. Add an assertion to `test_zip_bundles_cmr_invoice_and_letters`, or a new test, that a packet letter contains the letterhead text when the firm has one.

- [ ] **Step 5: Run `test_letterhead_render` + `test_document_generation`, expect PASS.**

- [ ] **Step 6: Visual check. This GATES reporting Task 4 done (manual, scratchpad only).** The automated PDF test uses a two-paragraph fixture blank and cannot catch layout drift. Re-run the 2026-10-05 prototype (`scratchpad/proto2.py`) through `generate()` with a repaired Yigit letterhead attached to a scratch firm in a test DB, or with the repaired file passed directly to `apply_letterhead`. Rasterize page 1 of each of the 3 letters. Check that the TK/EN columns and logo are intact, ARZA is 1 page, and the letter font and margins are unchanged. Open one merged .docx in **Word** (not only LibreOffice) and confirm it opens without a repair prompt, with the letter on page 1. Never attach the file to a live firm on the shared DB.

- [ ] **Step 7: Commit (on user instruction)**

```bash
git add backend/apps/contracts/services/letterhead_render.py backend/apps/contracts/services/document_render.py backend/apps/contracts/tests/test_letterhead_render.py backend/apps/contracts/tests/test_document_generation.py
git commit -m "feat(p4): request letters print on the seller's letterhead with their number"
```

---

### Task 5: Admin floors endpoint, manual number edit, packet payload

**Files:**
- Modify: `backend/apps/contracts/views.py` (new `LetterNumberBaseView` next to `InvoiceNumberBaseView` ~L986; new action on `ContractSaleViewSet`)
- Modify: `backend/apps/contracts/urls.py`
- Modify: `backend/apps/contracts/serializers.py` (`DocumentPacketSerializer.get_firms`, ~L667)
- Test: `backend/apps/contracts/tests/test_letter_number.py` (classes `LetterNumberBaseApiTest`, `LetterNumberEditApiTest`)

**Interfaces:**
- Produces (API, consumed by Tasks 7–8):
  - `GET /api/v1/contracts/letter-number-bases/?year=YYYY` → `{year, rows: [{export_firm, export_firm_code, export_firm_name, year, ct1, fito, customs}]}` (each an int floor, default 0).
  - `PUT /api/v1/contracts/letter-number-bases/` body `{export_firm, year, letter_type, last_number}` → the updated row (same shape). Admin only.
  - `PATCH /api/v1/contracts/sales/{id}/letter-numbers/` body any of `{ct1_number, fito_number, customs_number}` (int ≥ 1) → `{id, ct1_number, fito_number, customs_number}`. A taken number gives 400 `{error}`. Closed season → refused by the existing `SeasonNotClosed`.
  - The document-packets `firms[]` items gain `ct1_number`, `fito_number`, `customs_number` (int | null).

- [ ] **Step 1: Failing tests**

```python
class LetterNumberBaseApiTest(TestCase):
    URL = '/api/v1/contracts/letter-number-bases/'

    def setUp(self):
        self.firm = _make_export_firm('LBAPI')
        self.admin = User.objects.create(username='lb_admin', role='admin')
        self.manager = User.objects.create(username='lb_em', role='export_manager')
        self.client = APIClient()

    def test_get_defaults_to_zero(self):
        self.client.force_authenticate(self.manager)
        row = next(r for r in self.client.get(self.URL, {'year': 2026}).json()['rows']
                   if r['export_firm_code'] == 'LBAPI')
        self.assertEqual((row['ct1'], row['fito'], row['customs']), (0, 0, 0))

    def test_admin_put_one_type(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.URL, {'export_firm': self.firm.id, 'year': 2026,
                                          'letter_type': 'fito', 'last_number': 40}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((resp.json()['fito'], resp.json()['ct1']), (40, 0))

    def test_bad_type_is_400(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.put(self.URL, {'export_firm': self.firm.id, 'year': 2026,
                                          'letter_type': 'cmr', 'last_number': 1}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_non_admin_put_is_403(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.put(self.URL, {'export_firm': self.firm.id, 'year': 2026,
                                          'letter_type': 'ct1', 'last_number': 1}, format='json')
        self.assertEqual(resp.status_code, 403)


class LetterNumberEditApiTest(TestCase):
    # setUp: contract of firm F, sale A (2026-10-01, ct1_number=4), sale B (2026-10-02,
    # ct1_number=5), sale C of F in 2025 (ct1_number=9); admin APIClient.

    def _patch(self, sale, body):
        return self.client.patch(f'/api/v1/contracts/sales/{sale.id}/letter-numbers/', body, format='json')

    def test_free_number_saves(self):
        resp = self._patch(self.b, {'ct1_number': 20})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.b.refresh_from_db()
        self.assertEqual(self.b.ct1_number, 20)

    def test_taken_number_is_400(self):
        self.assertEqual(self._patch(self.b, {'ct1_number': 4}).status_code, 400)

    def test_same_value_is_ok(self):
        self.assertEqual(self._patch(self.b, {'ct1_number': 5}).status_code, 200)

    def test_other_year_is_ok(self):
        self.assertEqual(self._patch(self.b, {'ct1_number': 9}).status_code, 200)

    def test_zero_is_400(self):
        self.assertEqual(self._patch(self.b, {'fito_number': 0}).status_code, 400)

    def test_packet_lists_letter_numbers(self):
        # GET /api/v1/contracts/document-packets/?shipment=<id> → firms[0]['ct1_number'] == 4
        ...
```

Fill in the `...` body of `test_packet_lists_letter_numbers` using the shipment/split fixture from Task 3. Give sale A a shipment with a firm split. A sale with no shipment is not in packets.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

`LetterNumberBaseView` (place after `InvoiceNumberBaseView`, reuse `INT32_MAX`):

```python
class LetterNumberBaseView(APIView):
    """Request-letter numbering floors (spec 2026-10-05) — like «Нумерация инвойсов».

    ``GET ?year=`` → one row per active export firm with its ct1/fito/customs floors.
    ``PUT {export_firm, year, letter_type, last_number}`` → upsert one floor. Admin only.
    """

    permission_classes = [IsAuthenticated, write_permission('admin')]

    @staticmethod
    def _row(firm, year: int, floors: dict) -> dict:
        return {
            'export_firm': firm.id,
            'export_firm_code': firm.code,
            'export_firm_name': firm.name_short or firm.name_tk,
            'year': year,
            **{t: floors.get((firm.id, t), 0) for t in LETTER_TYPES},
        }

    @staticmethod
    def _floors(year: int, firm_id: int | None = None) -> dict:
        qs = LetterNumberBase.objects.filter(year=year)
        if firm_id is not None:
            qs = qs.filter(export_firm_id=firm_id)
        return {(f, t): n for f, t, n in qs.values_list('export_firm_id', 'letter_type', 'last_number')}

    def get(self, request):
        try:
            year = int(request.query_params.get('year') or timezone.localdate().year)
        except ValueError:
            return Response({'error': 'year must be a number.'}, status=400)
        floors = self._floors(year)
        firms = ExportFirm.objects.filter(is_active=True).order_by('code')
        return Response({'year': year, 'rows': [self._row(f, year, floors) for f in firms]})

    def put(self, request):
        try:
            firm_id = int(request.data['export_firm'])
            year = int(request.data['year'])
            last_number = int(request.data['last_number'])
            letter_type = str(request.data['letter_type'])
        except (KeyError, TypeError, ValueError):
            return Response({'error': 'export_firm, year, letter_type and last_number are required.'}, status=400)
        if letter_type not in LETTER_TYPES:
            return Response({'error': f'letter_type must be one of {", ".join(LETTER_TYPES)}.'}, status=400)
        if not 0 <= last_number <= INT32_MAX or not 2000 <= year <= 2100:
            return Response(
                {'error': f'last_number must be between 0 and {INT32_MAX}, and year within 2000–2100.'},
                status=400,
            )
        firm = ExportFirm.objects.filter(pk=firm_id).first()
        if firm is None:
            return Response({'error': 'Export firm not found.'}, status=400)
        LetterNumberBase.objects.update_or_create(
            export_firm=firm, letter_type=letter_type, year=year,
            defaults={'last_number': last_number, 'updated_by': request.user},
        )
        return Response(self._row(firm, year, self._floors(year, firm.id)))
```

Imports: `LetterNumberBase` from `apps.contracts.models`, `LETTER_TYPES` from `apps.contracts.models.letter_number_base`. URL: `path('letter-number-bases/', LetterNumberBaseView.as_view(), name='letter-number-bases')`.

`ContractSaleViewSet` action:

```python
    @action(detail=True, methods=['patch'], url_path='letter-numbers')
    def letter_numbers(self, request, pk=None):
        """Hand-correct a sale's CT-1 / Fito / ARZA numbers (spec 2026-10-05 §4)."""
        sale = self.get_object()
        updates = {}
        for letter_type, field in SALE_FIELD.items():
            if field not in request.data:
                continue
            try:
                number = int(request.data[field])
            except (TypeError, ValueError):
                return Response({'error': f'{field} must be a whole number.'}, status=400)
            if not 1 <= number <= INT32_MAX:
                return Response({'error': f'{field} must be at least 1.'}, status=400)
            if number_taken(sale, letter_type, number):
                return Response(
                    {'error': f'№ {number} уже занят другим письмом этой фирмы в этом году.'}, status=400,
                )
            updates[field] = number
        if not updates:
            return Response({'error': 'Nothing to update.'}, status=400)
        ContractSale.objects.filter(pk=sale.pk).update(**updates)
        sale.refresh_from_db()
        return Response({'id': sale.id, **{f: getattr(sale, f) for f in SALE_FIELD.values()}})
```

`INT32_MAX` is defined below the viewset in the same module. A module-level name used inside a method resolves at call time, so that is fine.

Permission check: `DynamicResourcePermission` maps PATCH → `edit` on `sale`, and `SeasonNotClosed` refuses closed-season writes. Confirm both by reading `apps/core/permissions.py`. If a custom action bypasses the method mapping, add a test `test_view_only_role_is_403` with a `boss` user.

Use `.update()` and skip `save()`: `save()` runs the totals rollup, which these columns do not affect.

`DocumentPacketSerializer.get_firms`, add to each dict:

```python
                **{f: (getattr(sale, f) if sale else None)
                   for f in ('ct1_number', 'fito_number', 'customs_number')},
```

- [ ] **Step 4: Run, expect PASS.** Also run `test_document_generation` (packet payload tests).

- [ ] **Step 5: Commit (on user instruction)**

```bash
git add backend/apps/contracts/views.py backend/apps/contracts/urls.py backend/apps/contracts/serializers.py backend/apps/contracts/tests/test_letter_number.py
git commit -m "feat(p4): letter-number floors endpoint and manual letter-number edit"
```

---

### Task 6: Frontend — letterhead upload on the export firm page

**Files:**
- Modify: `frontend/src/types/index.ts` (`IExportFirm`: add `letterhead: string | null`)
- Modify: `frontend/src/hooks/useAdmin.ts` (`ExportFirmPayload` Omit list + `useUploadExportFirmFile` field type)
- Modify: `frontend/src/pages/admin/ExportFirmDetailPage.tsx` (`FileUploadCard` props + a new card in the stamps block ~L414-440)
- Modify: `frontend/src/i18n/{en,ru,tk}.json` (`firms_admin.letterhead`, `firms_admin.letterhead_hint`, `firms_admin.letterhead_open`)
- Test: `frontend/src/pages/admin/ExportFirmDetailPage.letterhead.test.tsx`

**Interfaces:**
- Consumes: `PATCH /export/admin/firms/{id}/` multipart field `letterhead` (Task 1). A 400 body `{letterhead: [msg]}`.

- [ ] **Step 1: Failing test.** Mock `@/services/api` the way `InvoiceNumberingPage.test.tsx` does. Render the page for a firm with `letterhead: null`. Upload a `File(['x'], 'blank.docx')` through the letterhead `Upload` input. Expect `api.patch` called with `/export/admin/firms/1/` and a FormData whose `letterhead` entry is that file. Second test: with `letterhead: '/media/export_firms/letterheads/a.docx'`, a link with that href is shown, not an `<img>`.

- [ ] **Step 2: Run, expect FAIL**: `cd frontend && npx vitest run src/pages/admin/ExportFirmDetailPage.letterhead.test.tsx`

- [ ] **Step 3: Implement.**
  - `useAdmin.ts`: `export type FirmUploadField = FirmStampField | 'letterhead';` In `useUploadExportFirmFile`, type `field: FirmUploadField`. Add `'letterhead'` to the `ExportFirmPayload` Omit list.
  - `FileUploadCard`: add props `accept?: string` (default `'image/*'`) and `preview?: 'image' | 'link'` (default `'image'`). When `preview === 'link'` and `currentUrl`, render `<a href={currentUrl} target="_blank" rel="noreferrer">{openLabel}</a>` instead of the `<img>`, with a new prop `openLabel?: string`.
  - New card after the stamp cards:

```tsx
<FileUploadCard
  label={t('firms_admin.letterhead')}
  currentUrl={firm.letterhead}
  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  preview="link"
  openLabel={t('firms_admin.letterhead_open')}
  onUpload={(file) => uploadFileMutation.mutate({ id: firm.id, field: 'letterhead', file })}
  isUploading={uploadFileMutation.isPending}
  uploadLabel={t('firms_admin.upload')}
  replaceLabel={t('firms_admin.replace')}
  tooltip={t('firms_admin.letterhead_hint')}
/>
```

  Use the same `uploadLabel` / `replaceLabel` keys the neighbouring cards use. Read them from ~L414-440 rather than guessing. Make sure the existing `onError` of `uploadFileMutation` shows the server message (`err.response.data.letterhead[0]`). If it only shows a generic toast, extend it to prefer that field's message.
  - i18n ru: `letterhead`: «Фирменный бланк (.docx)», `letterhead_hint`: «Печатается вверху писем СТ-1, Фито и ARZA. В бланке должно быть «№ ___» — туда ставится номер письма. Новая загрузка заменяет старый бланк.», `letterhead_open`: «Открыть бланк». Translate the same text into en and tk.

- [ ] **Step 4: Run test + `npx tsc --noEmit --ignoreDeprecations 5.0`, expect PASS.**

- [ ] **Step 5: Commit (on user instruction)**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useAdmin.ts frontend/src/pages/admin/ExportFirmDetailPage.tsx frontend/src/pages/admin/ExportFirmDetailPage.letterhead.test.tsx frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git commit -m "feat(frontend): upload a firm letterhead on the export firm page"
```

`hooks/useAdmin.ts`, `types/index.ts` and the i18n files already carry another session's uncommitted edits (git status at session start). Stage only this task's hunks: use a private `GIT_INDEX_FILE` with hunk selection (memory `project_shared_worktree_sessions`). Never stage whole files.

---

### Task 7: Frontend — letter floors on «Нумерация инвойсов»

**Files:**
- Create: `frontend/src/hooks/useLetterNumberBases.ts`
- Modify: `frontend/src/pages/admin/InvoiceNumberingPage.tsx`
- Modify: `frontend/src/i18n/{en,ru,tk}.json` (`invoice_numbering.col_ct1`, `col_fito`, `col_customs`)
- Test: `frontend/src/pages/admin/InvoiceNumberingPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET/PUT /contracts/letter-number-bases/` (Task 5).
- Produces: `useLetterNumberBases(year) -> ILetterNumberBaseRow[]`, `useSaveLetterNumberBase()` with body `{export_firm, year, letter_type: 'ct1'|'fito'|'customs', last_number}`.

- [ ] **Step 1: Failing test.** In the existing test file, mock the GET for `/contracts/letter-number-bases/` returning a row `{export_firm: 1, …, ct1: 3, fito: 0, customs: 0}`. Blur the CT-1 input after typing 12. Expect `mockPut` called with `'/contracts/letter-number-bases/', {export_firm: 1, year: <current>, letter_type: 'ct1', last_number: 12}`. Look at how the file's existing mocks branch on URL and extend that.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `useLetterNumberBases.ts`, mirroring `useInvoiceNumberBases.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export type LetterType = 'ct1' | 'fito' | 'customs';

export interface ILetterNumberBaseRow {
  export_firm: number;
  export_firm_code: string;
  export_firm_name: string;
  year: number;
  ct1: number;
  fito: number;
  customs: number;
}

const KEY = 'letter-number-bases';

/** Per-firm yearly request-letter number floors (spec 2026-10-05). */
export function useLetterNumberBases(year: number) {
  return useQuery({
    queryKey: [KEY, year] as const,
    queryFn: async () => {
      const { data } = await api.get<{ year: number; rows: ILetterNumberBaseRow[] }>(
        '/contracts/letter-number-bases/', { params: { year } },
      );
      return data.rows;
    },
  });
}

export function useSaveLetterNumberBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { export_firm: number; year: number; letter_type: LetterType; last_number: number }) => {
      const { data } = await api.put<ILetterNumberBaseRow>('/contracts/letter-number-bases/', body);
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: [KEY, row.year] });
    },
  });
}
```

In `InvoiceNumberingPage.tsx`: call both hooks and build `const letterByFirm = new Map((letterRows ?? []).map((r) => [r.export_firm, r]));`. Add three columns after `col_last_number`, each built by a helper:

```tsx
const letterColumn = (type: LetterType, titleKey: string) => ({
  title: t(titleKey),
  key: type,
  render: (_: unknown, row: IInvoiceNumberBaseRow) => {
    const value = letterByFirm.get(row.export_firm)?.[type] ?? 0;
    return canWrite ? (
      <InputNumber
        key={`${row.export_firm}-${year}-${type}-${value}`}
        min={0}
        precision={0}
        defaultValue={value}
        onBlur={(e) => commitLetter(row.export_firm, type, value, e.target.value === '' ? null : Number(e.target.value))}
        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      />
    ) : value;
  },
});
```

`commitLetter` mirrors `commit`: skip null or unchanged, `saveLetter.mutate({export_firm, year, letter_type: type, last_number: value}, {onSuccess/onError toasts as commit})`. i18n ru: `col_ct1` «СТ-1 — последний №», `col_fito` «Фито — последний №», `col_customs` «ARZA — последний №». Translate the same text into en and tk.

- [ ] **Step 4: Run test + tsc, expect PASS.**

- [ ] **Step 5: Commit (on user instruction)**: `feat(frontend): request-letter number floors on the numbering page`. Stage hunks only for the i18n files (see Task 6).

---

### Task 8: Frontend — letter number + manual edit in the shipment «Документы»

**Files:**
- Modify: `frontend/src/types/index.ts` (`IDocumentPacketFirm`: add `ct1_number`, `fito_number`, `customs_number: number | null`)
- Create: `frontend/src/hooks/useSaleLetterNumbers.ts`
- Create: `frontend/src/components/shipment/LetterNumberEdit.tsx`
- Modify: `frontend/src/components/shipment/ShipmentDocsFirmGroup.tsx` (`LETTERS` map + row label)
- Modify: `frontend/src/i18n/{en,ru,tk}.json` (`shipment_detail.docs.letter_number_edit`, `letter_number_saved`)
- Test: `frontend/src/components/shipment/LetterNumberEdit.test.tsx`

**Interfaces:**
- Consumes: `PATCH /contracts/sales/{id}/letter-numbers/` and the packet `firms[].ct1_number|fito_number|customs_number` (Task 5).
- Produces: `<LetterNumberEdit saleId={number} field={'ct1_number'|'fito_number'|'customs_number'} value={number|null} canEdit={boolean} />`.

- [ ] **Step 1: Failing tests** (`LetterNumberEdit.test.tsx`):
  - `value=15` renders the text `№ 15`.
  - `value=null` renders nothing.
  - Clicking ✎, typing 20 and pressing save calls `api.patch('/contracts/sales/7/letter-numbers/', {ct1_number: 20})`.
  - A rejected patch with `{response: {data: {error: 'taken'}}}` shows `taken` (sonner `toast.error` mocked).
  - `canEdit=false` shows no ✎ button.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

`useSaleLetterNumbers.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

export type LetterNumberField = 'ct1_number' | 'fito_number' | 'customs_number';

/** Hand-correct one request-letter number on a sale (spec 2026-10-05 §4). */
export function useSaveLetterNumber(saleId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Record<LetterNumberField, number>>) => {
      const { data } = await api.patch(`/contracts/sales/${saleId}/letter-numbers/`, body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-packets'] });
    },
  });
}
```

`LetterNumberEdit.tsx`: an antd `Popover` (trigger click) holding an `InputNumber min={1} precision={0}` and a save `Button`. The visible part is `<Text type="secondary">№ {value}</Text>` plus a small `Button type="text" icon={<EditOutlined />}` with `aria-label={t('shipment_detail.docs.letter_number_edit')}` when `canEdit`. On save: `mutate({[field]: n}, {onSuccess: () => { toast.success(t('shipment_detail.docs.letter_number_saved')); close(); }, onError: (e) => toast.error(e.response?.data?.error ?? t('common.error')) })`. Use the project's existing axios error type helper if there is one (grep `response?.data?.error` in `src/`).

`ShipmentDocsFirmGroup.tsx`: extend `LETTERS` with `field: 'ct1_number' | 'fito_number' | 'customs_number'`. Pass a ReactNode label (`DocumentDownloadRow.label` is `ReactNode`):

```tsx
label={<>{t(labelKey)} <LetterNumberEdit saleId={firm.sale_id} field={field} value={firm[field]} canEdit={canEditSale} /></>}
```

`canEditSale`: find how the shipment Documents section already gates edit actions on the `sale` resource (grep `canDo('sale'` / `useCanDo` under `components/shipment/`). Use the same check. Do not invent a role list.

- [ ] **Step 4: Run test + the existing `ShipmentDocumentsCard.test.tsx` + tsc, expect PASS.** Update mock packet fixtures (`src/mock/` or test files) with the 3 new nullable fields if tsc requires it.

- [ ] **Step 5: Commit (on user instruction)**: `feat(frontend): show and hand-correct request-letter numbers on the shipment page`. Stage hunks only for shared files.

---

### Task 9: Docs, changelog, test log (main session)

**Files:**
- Modify: `docs/obsidian/processes/document-generation.md` (letterhead + numbering section). The file already has another session's uncommitted edit, so add hunks only.
- Modify: the Obsidian notes for the export firm model and the numbering screen. Find them via `docs/obsidian/00-index.md` (grep `ExportFirm`, `invoice-numbering`).
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added), `BUILD_TEST_LOG.md` (newest on top: `- [ ] 2026-10-05 — Firm letterhead + CT-1/Fito/ARZA numbers — NEEDS TEST`, listing the manual checks: upload the repaired Yigit blank, download the 3 letters as docx and pdf, open in Word, edit a number, set a floor)
- Modify: `DECISIONS.md` (one entry: letterhead per firm, numbers per firm × type × year, allocated at link, gap-fill like invoices)

- [ ] **Step 1:** Write the doc updates.
- [ ] **Step 2: Commit (on user instruction)**: `docs: firm letterhead and request-letter numbering`.

## Deploy (only on the user's instruction)

Run `migrate core contracts` on beta via the usual `update.sh`. No seed is needed. Floors default to 0, so letters numbered on beta start at 1 unless an admin sets the floors first. Tell the user to set the floors before the first «Привязать» after deploy.
