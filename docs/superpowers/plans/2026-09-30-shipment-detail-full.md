# Shipment Detail — Sheet parity + three parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/shipments/:id` shows every Sheet field, lets the user choose the transport part (Planning trip) and move the packaging part (unjoin / swap) in-page, embeds the gross/net packing panel, the per-firm contracts panel and the full document packet (view + print, no trip to Documents), and every task target field has a reachable row.

**Architecture:** One backend change (detail serializer gains 9 read fields). The frontend reuses what exists: `DetailFieldRow` autosave for all new scalar rows (declared in a new `DETAIL_EXTRA_FIELDS` config so the Edit drawer is untouched), the Sheet's `ShipmentPackingPanel` / `ShipmentFirmContractsPanel`, and the existing trip / packing hooks. New UI pieces are two modals (`TripPickerModal`, `SwapPackingModal`), one button strip (`ShipmentPackingActions`), and one custom-rows block. No new endpoints.

**Tech Stack:** Django 5 + DRF on MSSQL, React 18 + TypeScript + Ant Design + TanStack Query, Vitest + RTL (happy-dom).

**Spec:** `docs/superpowers/specs/2026-09-30-shipment-detail-full-design.md`

## Global Constraints

- MSSQL: no JSONField/ArrayField/DISTINCT ON. The new `custom_fields` is a `SerializerMethodField` returning a list — no schema change, **no migration in this plan**.
- API names = DB names for every new field (they are plain model columns / a model property).
- Trip actions: button visible only if `canSeePage(user, 'export.truck_board') && canDo(user, 'shipment_assign', 'edit')`; "choose" only for non-gapy, `status_code === 'draft'`, no `trip_id`; disabled while `country_code` is null.
- Packing actions: `canUserJoin(user)` + `isPreLoading(status_code)` + has blocks; unjoin additionally needs `country` and `customer`.
- Documents print card: visible only if `canDo(user, 'sale', 'view')` (the document-packets endpoint is gated by resource `sale`).
- Rows removed from Detail only (never from `EDIT_FIELD_GROUPS`): `weight_gross`, `packaging_kg`, `pallet_count`, `box_count`.
- Row labels reuse the Sheet's `sheet.row.*` keys so Detail and Sheet read the same. New i18n keys live only under `shipment_detail.parts.*`.
- UI copy never says draft / черновик / garalama.
- **Commits:** CLAUDE.md forbids committing without the user's explicit "commit". Ask once at the start of execution whether the per-task commit steps are approved; if not, skip every commit step.
- **Shared tree:** other sessions edit this tree and share the git index. Before every commit: `git status`, `git diff --cached`; stage only this task's paths. If a file you touch is also dirty from another session (check `git diff <file>` for hunks you did not write), commit only your hunks via a private index (memory "Shared Worktree Sessions"), never the whole file.
- **i18n edits:** add keys with the Edit tool next to existing keys. Never rewrite a locale file with `json.dump` — it re-orders and re-escapes the whole file.
- **Test runs:** backend `cd backend && ./venv/Scripts/python.exe manage.py test <label> --noinput --verbosity=1`. If another `manage.py test` process is running, use a private test DB (memory "Test DB Name Collision"). Frontend `cd frontend && npx vitest run <path>`; typecheck `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` (`npm run type-check` is broken).

## Review Focus

1. A trip with no destination country: the user must confirm, and the request must carry `confirm_unknown_country: true` — Task 3 test "unknown country asks first".
2. A shipment past `draft` without a trip: no "choose trip" button (backend would answer `not_draft`) — Task 3 test "no choose button after draft".
3. `has_peregruz` is tri-state: choosing «Нет» must save `false`, clearing must save `null`, never collapse to one — Task 2 test "yes_no editor".
4. Swap candidates: never the current row, never a row without packing or past loading — Task 4 test "swap candidates".
5. A custom row blurred without a change must not PATCH (each PATCH writes an audit row) — Task 6 test "unchanged blur does not save".

---

### Task 1: Backend — detail serializer Sheet-parity fields

**Files:**
- Modify: `backend/apps/export/serializers.py` (class `ShipmentDetailSerializer`, ~L1303-1645)
- Create: `backend/apps/export/tests_detail_sheet_parity.py`
- Modify: `.claude/skills/api-contract/SKILL.md` (section "Detail endpoint", ~L65-104)

**Interfaces:**
- Produces (JSON on `GET /api/v1/export/shipments/{id}/`, used by Tasks 2-6):
  `greenhouse_arrived_at: str|null`, `pallet_weight_kg: "25.00"|null` (decimal string), `shelf_life_days: int|null`, `packing_template: int|null`, `packing_template_name: str|null`, `truck_head_2_id: int|null`, `driver_2_id: int|null`, `has_current_advance: bool`, `custom_fields: [{field_key, label_tk, label_ru, label_en, value: str|null}]` ordered by `display_order`.

- [ ] **Step 1: Write the failing test**

`backend/apps/export/tests_detail_sheet_parity.py`:

```python
"""GET /shipments/{id}/ carries the Sheet-parity fields the Detail page renders
(docs/superpowers/specs/2026-09-30-shipment-detail-full-design.md §6)."""
from decimal import Decimal

from rest_framework.test import APITestCase

from apps.core.models import Season, ShipmentStatusType, User
from apps.export.models import (
    FinansistAdvance,
    FinansistAdvanceShipment,
    SheetRowSetting,
    Shipment,
    ShipmentCustomFieldValue,
)


class DetailSheetParityTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='2025-2026', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        cls.draft = ShipmentStatusType.objects.create(code='draft', name_tk='Taýýarlyk', step_order=0)
        # Read is gated by shipment.can_view; the test DB has no seeded role
        # perms, so use a superuser (same as tests_completeness_api.py).
        cls.user = User.objects.create_superuser(username='boss', password='pw')
        cls.shipment = Shipment.objects.create(
            shipment_code='0101002/26', date='2026-01-01', status=cls.draft, season=cls.season,
            shelf_life_days=12, pallet_weight_kg=Decimal('25.00'),
            greenhouse_arrived_at='2026-01-01T08:00:00Z',
        )

    def _get(self) -> dict:
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f'/api/v1/export/shipments/{self.shipment.id}/')
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_scalar_parity_fields(self):
        data = self._get()
        self.assertEqual(data['shelf_life_days'], 12)
        self.assertEqual(Decimal(data['pallet_weight_kg']), Decimal('25.00'))
        self.assertIsNotNone(data['greenhouse_arrived_at'])
        for key in ('packing_template', 'packing_template_name', 'truck_head_2_id', 'driver_2_id'):
            self.assertIn(key, data)
            self.assertIsNone(data[key])

    def test_has_current_advance_follows_linked_advance(self):
        self.assertFalse(self._get()['has_current_advance'])
        advance = FinansistAdvance.objects.create(
            advance_date='2026-01-02', total_amount=Decimal('100'), currency='TMT', issued_by=self.user,
        )
        FinansistAdvanceShipment.objects.create(advance=advance, shipment=self.shipment)
        self.assertTrue(self._get()['has_current_advance'])

    def test_custom_fields_list_visible_rows_with_values(self):
        filled = SheetRowSetting.objects.create(
            field_key='custom_seal', row_number=90, display_order=90_000, is_custom=True,
            label_tk='Plomba', label_ru='Пломба', label_en='Seal',
        )
        SheetRowSetting.objects.create(
            field_key='custom_empty', row_number=91, display_order=91_000, is_custom=True,
            label_tk='Boş', label_ru='Пусто', label_en='Empty',
        )
        SheetRowSetting.objects.create(
            field_key='custom_hidden', row_number=92, display_order=92_000, is_custom=True,
            is_visible=False, label_tk='Gizlin', label_ru='Скрыто', label_en='Hidden',
        )
        ShipmentCustomFieldValue.objects.create(shipment=self.shipment, row=filled, value_text='A-17')

        entries = self._get()['custom_fields']

        self.assertEqual(
            [(e['field_key'], e['value']) for e in entries],
            [('custom_seal', 'A-17'), ('custom_empty', None)],
        )
        self.assertEqual(entries[0]['label_ru'], 'Пломба')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_detail_sheet_parity --noinput --verbosity=1`
Expected: FAIL — `KeyError: 'shelf_life_days'` (and similar for the other two tests).

- [ ] **Step 3: Implement**

In `ShipmentDetailSerializer`, next to the other declared fields (after `comment_count = serializers.SerializerMethodField()`), add:

```python
    # ── Sheet parity (spec 2026-09-30-shipment-detail-full-design.md §6) ──
    packing_template_name = serializers.CharField(
        source='packing_template.name', read_only=True, default=None,
    )
    # Model @property — the give_advance task target; after a truck-change
    # rollback only an advance created after documents_reset_at counts.
    has_current_advance = serializers.BooleanField(read_only=True)
    custom_fields = serializers.SerializerMethodField()
```

Next to `get_comment_count`, add:

```python
    def get_custom_fields(self, obj: Shipment) -> list[dict]:
        """Every visible admin-created custom Sheet row with this shipment's
        value (None when never written) — the Detail page renders one row each."""
        from apps.export.models import SheetRowSetting, ShipmentCustomFieldValue

        values = dict(
            ShipmentCustomFieldValue.objects
            .filter(shipment=obj)
            .values_list('row_id', 'value_text')
        )
        rows = SheetRowSetting.objects.visible().filter(is_custom=True).order_by('display_order')
        return [
            {
                'field_key': row.field_key,
                'label_tk': row.label_tk,
                'label_ru': row.label_ru,
                'label_en': row.label_en,
                'value': values.get(row.pk),
            }
            for row in rows
        ]
```

At the end of `Meta.fields` (after `'can_promote_from_draft',`) add:

```python
            # Sheet parity (spec 2026-09-30-shipment-detail-full-design.md §6)
            'greenhouse_arrived_at',
            'pallet_weight_kg',
            'shelf_life_days',
            'packing_template',
            'packing_template_name',
            'truck_head_2_id',
            'driver_2_id',
            'has_current_advance',
            'custom_fields',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_detail_sheet_parity apps.export.tests_completeness_api --noinput --verbosity=1`
Expected: PASS (4 tests).

- [ ] **Step 5: Update the API contract**

In `.claude/skills/api-contract/SKILL.md`, inside the Detail endpoint JSON block, after the `"comments": [...]` line add:

```json
  // Sheet parity (2026-09-30): scalar columns the Detail page renders.
  "greenhouse_arrived_at": "2026-01-01T08:00:00Z",
  "pallet_weight_kg": "25.00",          // decimal string
  "shelf_life_days": 12,
  "packing_template": 3, "packing_template_name": "2 firms 20t",
  "truck_head_2_id": null, "driver_2_id": null,
  "has_current_advance": false,         // model property — give_advance target
  // Every visible custom Sheet row (SheetRowSetting.is_custom), value null if never written.
  // Written via PATCH /shipments/{id}/custom-fields/ {field_key, value}.
  "custom_fields": [
    { "field_key": "custom_seal", "label_tk": "Plomba", "label_ru": "Пломба", "label_en": "Seal", "value": "A-17" }
  ],
```

- [ ] **Step 6: Commit** (only if approved)

```bash
git status
git add backend/apps/export/serializers.py backend/apps/export/tests_detail_sheet_parity.py .claude/skills/api-contract/SKILL.md
git diff --cached --stat
git commit -m "feat(p3): shipment detail API carries the Sheet-parity fields"
```

---

### Task 2: Frontend foundation — types, yes/no editor, extra-field config and rows, completeness anchors, i18n

**Files:**
- Modify: `frontend/src/types/index.ts` (`IShipmentDetail`, ~L1705)
- Modify: `frontend/src/mock/shipmentDetail.ts`
- Modify: `frontend/src/constants/shipmentEditConfig.ts`
- Modify: `frontend/src/components/FieldEditor.tsx`
- Modify: `frontend/src/components/shipment/DetailFieldRow.helpers.ts` (`AUTO_OPEN_TYPES`)
- Create: `frontend/src/components/shipment/DetailExtraFieldRows.tsx`
- Modify: `frontend/src/components/shipment/ShipmentFieldGroup.tsx` (`countMissing`)
- Modify: `frontend/src/components/shipment/ShipmentCompletenessBar.helpers.ts`
- Modify: `frontend/src/components/shipment/ShipmentCompletenessBar.test.tsx` (departed_at test)
- Modify: `frontend/src/i18n/en.json`, `ru.json`, `tk.json`
- Create: `frontend/src/components/shipment/DetailExtraFieldRows.test.tsx`

**Interfaces:**
- Consumes: Task 1 JSON fields.
- Produces:
  - `interface IShipmentCustomField { field_key: string; label_tk: string; label_ru: string; label_en: string; value: string | null }` (exported from `@/types`)
  - `IShipmentDetail` gains `greenhouse_arrived_at: string | null; pallet_weight_kg: string | null; shelf_life_days: number | null; packing_template: number | null; packing_template_name: string | null; truck_head_2_id: number | null; driver_2_id: number | null; has_current_advance: boolean; custom_fields: IShipmentCustomField[]`
  - `FieldInputType` gains `'yes_no'`
  - `DETAIL_EXTRA_FIELDS: Record<IEditFieldGroup['key'], IEditFieldConfig[]>` from `@/constants/shipmentEditConfig`
  - `SECOND_RIG_KEYS: ReadonlySet<string>` from `@/constants/shipmentEditConfig`
  - `DetailExtraFieldRows(props: { shipment: IShipmentDetail; fields: readonly IEditFieldConfig[]; missingKeys: Set<string>; readOnly: boolean; lockedKeys?: ReadonlySet<string>; onOpenComments?: (fieldKey: string) => void; commentCountsByField?: Record<string, number> })`
  - i18n keys `shipment_detail.parts.{choose_trip, choose_trip_title, no_free_trips, need_country, trip_linked, trip_unlinked, swap_title, swap_empty, truck_plate_2, driver_2_name, driver_2_phone, harvest_by_block, documents_title, documents_no_firm}`

- [ ] **Step 1: Types and mock**

In `types/index.ts`, directly above `export interface IShipmentDetail extends IShipmentListItem {` add:

```ts
/** One admin-created custom Sheet row with this shipment's value (detail API). */
export interface IShipmentCustomField {
  field_key: string;
  label_tk: string;
  label_ru: string;
  label_en: string;
  value: string | null;
}
```

Inside `IShipmentDetail`, after `completeness: ICompleteness;` add:

```ts
  // Sheet parity (spec 2026-09-30-shipment-detail-full-design.md §6)
  greenhouse_arrived_at: string | null;
  /** DecimalField — string on the wire. */
  pallet_weight_kg: string | null;
  shelf_life_days: number | null;
  packing_template: number | null;
  packing_template_name: string | null;
  truck_head_2_id: number | null;
  driver_2_id: number | null;
  /** tasks.give_advance target (model property). */
  has_current_advance: boolean;
  custom_fields: IShipmentCustomField[];
```

In `mock/shipmentDetail.ts`, add to `MOCK_SHIPMENT_DETAIL`:

```ts
  greenhouse_arrived_at: null,
  pallet_weight_kg: null,
  shelf_life_days: null,
  packing_template: null,
  packing_template_name: null,
  truck_head_2_id: null,
  driver_2_id: null,
  has_current_advance: false,
  custom_fields: [],
```

Run `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0`. Fix any other `IShipmentDetail` literal it reports (same nine lines).

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/shipment/DetailExtraFieldRows.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { FieldEditor } from '@/components/FieldEditor';
import { DetailExtraFieldRows } from './DetailExtraFieldRows';
import { DETAIL_EXTRA_FIELDS, type IEditFieldConfig } from '@/constants/shipmentEditConfig';
import { countMissing } from './ShipmentFieldGroup';
import { EDITABLE_FIELD_KEYS, sectionAnchorFor } from './ShipmentCompletenessBar.helpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({ default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() } }));
vi.mock('@/hooks/useAdmin', () => ({
  useCountries: () => ({ data: [] }), useCities: () => ({ data: [] }), useCustomers: () => ({ data: [] }),
  useAdminImportFirms: () => ({ data: [] }), useTomatoVarieties: () => ({ data: [] }),
  useBorderPoints: () => ({ data: [] }), useShipmentOptions: () => ({ data: [] }),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderRows(shipment: IShipmentDetail, fields: readonly IEditFieldConfig[], locked?: ReadonlySet<string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DetailExtraFieldRows shipment={shipment} fields={fields} missingKeys={new Set(['dest_entry_at'])}
        readOnly={false} lockedKeys={locked} />
    </QueryClientProvider>,
  );
}

describe('DetailExtraFieldRows', () => {
  it('formats datetimes and yes/no in read mode and ids every row', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, dest_entry_at: '2026-09-30T10:00:00Z', has_peregruz: false };
    const { container } = renderRows(shipment, DETAIL_EXTRA_FIELDS.transport);
    expect(screen.getByText(fmt('2026-09-30T10:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-dest_entry_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-peregruz_city')).not.toBeNull();
  });

  it('renders a locked key read-only (no tab stop)', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, truck_plate_2: 'AB1234' };
    renderRows(shipment, DETAIL_EXTRA_FIELDS.transport, new Set(['truck_plate_2']));
    expect(screen.getByText('AB1234')).toHaveAttribute('tabindex', '-1');
  });
});

describe('yes_no editor', () => {
  const config: IEditFieldConfig = { key: 'has_peregruz', labelKey: 'sheet.row.peregruz_status', inputType: 'yes_no' };

  it('saves No as false and Yes as true', () => {
    const onChange = vi.fn();
    render(<FieldEditor config={config} value={null} onChange={onChange} defaultOpen />);
    fireEvent.click(screen.getByText('No'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the stored false as No, not as empty', () => {
    render(<FieldEditor config={config} value={false} onChange={vi.fn()} />);
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});

describe('completeness wiring for the extra rows', () => {
  it('counts extra keys on their card and makes them jumpable', () => {
    expect(countMissing('transport', new Set(['dest_entry_at']))).toBe(1);
    expect(EDITABLE_FIELD_KEYS.has('loading_ended_at')).toBe(true);
    expect(sectionAnchorFor('trip_id')).toBe('detail-field-trip_id');
    expect(sectionAnchorFor('packing_template')).toBe('detail-field-packing_template');
    expect(sectionAnchorFor('has_current_advance')).toBe('detail-field-has_current_advance');
    expect(sectionAnchorFor('sales_report.approved_at')).toBe('section-sale');
    expect(sectionAnchorFor('quality.hil_sertifikaty')).toBe('detail-field-quality.hil_sertifikaty');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/DetailExtraFieldRows.test.tsx`
Expected: FAIL — cannot resolve `./DetailExtraFieldRows` / `DETAIL_EXTRA_FIELDS` is not exported.

- [ ] **Step 4: Config**

In `constants/shipmentEditConfig.ts`:

Change the `FieldInputType` union to add `| 'yes_no'` after `| 'boolean'`, and document it:

```ts
  | 'boolean'
  /** Tri-state answer (null = not answered yet, false = explicit «No»). */
  | 'yes_no';
```

After `EDIT_FIELD_GROUPS` add:

```ts
/**
 * Detail-page rows beyond EDIT_FIELD_GROUPS (spec
 * 2026-09-30-shipment-detail-full-design.md). Kept out of EDIT_FIELD_GROUPS so
 * ShipmentEditDrawer does not change. Keyed by the group whose card renders
 * them; labels reuse the Sheet row's label key so both screens read the same.
 */
export const DETAIL_EXTRA_FIELDS: Record<IEditFieldGroup['key'], IEditFieldConfig[]> = {
  logistics: [],
  transport: [
    { key: 'vehicle_live_status', labelKey: 'sheet.row.vehicle_live_status', inputType: 'text' },
    { key: 'transport_docs_given_at', labelKey: 'sheet.row.transport_docs_given', inputType: 'datetime' },
    { key: 'shelf_life_days', labelKey: 'shipment_edit_drawer.field.shelf_life_days', inputType: 'number', min: 0, suffix: 'd' },
    { key: 'truck_plate_2', labelKey: 'shipment_detail.parts.truck_plate_2', inputType: 'text' },
    { key: 'driver_2_name', labelKey: 'shipment_detail.parts.driver_2_name', inputType: 'text' },
    { key: 'driver_2_phone', labelKey: 'shipment_detail.parts.driver_2_phone', inputType: 'text' },
    { key: 'greenhouse_arrived_at', labelKey: 'sheet.row.greenhouse_arrival', inputType: 'datetime' },
    { key: 'departed_at', labelKey: 'sheet.row.greenhouse_departure', inputType: 'datetime' },
    { key: 'border_crossed_at', labelKey: 'sheet.row.border_exit', inputType: 'datetime' },
    { key: 'dest_entry_at', labelKey: 'sheet.row.dest_entry', inputType: 'datetime' },
    { key: 'has_peregruz', labelKey: 'sheet.row.peregruz_status', inputType: 'yes_no' },
    { key: 'peregruz_date', labelKey: 'sheet.row.peregruz_time', inputType: 'datetime' },
    { key: 'peregruz_city', labelKey: 'shipments.peregruz_city', inputType: 'text' },
    { key: 'arrived_at', labelKey: 'sheet.row.arrival', inputType: 'datetime' },
  ],
  goods: [
    { key: 'loading_started_at', labelKey: 'sheet.row.loading_start', inputType: 'datetime' },
    { key: 'loading_ended_at', labelKey: 'sheet.row.loading_end', inputType: 'datetime' },
  ],
  finance: [
    { key: 'sale_started_at', labelKey: 'sheet.row.sale_start', inputType: 'datetime' },
    { key: 'sale_ended_at', labelKey: 'sheet.row.sale_end', inputType: 'datetime' },
    { key: 'sales_report_date', labelKey: 'sheet.row.report_date', inputType: 'date' },
  ],
  status: [
    { key: 'document_note', labelKey: 'sheet.row.document_notes', inputType: 'textarea' },
    { key: 'customs_exit_at', labelKey: 'sheet.row.customs_exit_tm', inputType: 'datetime' },
    { key: 'customs_entry_at', labelKey: 'sheet.row.dest_customs', inputType: 'datetime' },
  ],
  notes: [
    { key: 'export_manager_note', labelKey: 'sheet.row.export_manager_note', inputType: 'textarea' },
    { key: 'warehouse_note', labelKey: 'sheet.row.warehouse_notes', inputType: 'textarea' },
    { key: 'additional_notes_arap', labelKey: 'sheet.row.additional_notes_arap', inputType: 'textarea' },
  ],
};

/** Second-rig rows: read-only while a Planning trip owns the transport fields. */
export const SECOND_RIG_KEYS: ReadonlySet<string> = new Set(['truck_plate_2', 'driver_2_name', 'driver_2_phone']);
```

- [ ] **Step 5: yes/no editor**

In `components/FieldEditor.tsx`: change `const { i18n } = useTranslation();` to `const { t, i18n } = useTranslation();`, and add before `case 'boolean':`:

```tsx
    case 'yes_no':
      // Tri-state: null = not answered. «No» must reach the API as false, not null.
      return (
        <Select
          value={value === true ? 'yes' : value === false ? 'no' : undefined}
          onChange={(v) => onChange(v === 'yes' ? true : v === 'no' ? false : null)}
          options={[
            { value: 'yes', label: t('common.yes') },
            { value: 'no', label: t('common.no') },
          ]}
          disabled={disabled}
          autoFocus={autoFocus}
          defaultOpen={defaultOpen}
          allowClear
          style={{ width: '100%' }}
        />
      );
```

In `components/shipment/DetailFieldRow.helpers.ts` add `'yes_no',` to `AUTO_OPEN_TYPES`.

- [ ] **Step 6: DetailExtraFieldRows**

`frontend/src/components/shipment/DetailExtraFieldRows.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { fmt, fmtDate } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

interface IDetailExtraFieldRowsProps {
  shipment: IShipmentDetail;
  fields: readonly IEditFieldConfig[];
  missingKeys: Set<string>;
  readOnly: boolean;
  /** Keys rendered read-only even when the card is editable. */
  lockedKeys?: ReadonlySet<string>;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * Autosaving rows for DETAIL_EXTRA_FIELDS. Dates and yes/no answers get a
 * read-mode formatter — DetailFieldRow alone would print the raw ISO string
 * or boolean.
 */
export function DetailExtraFieldRows({
  shipment,
  fields,
  missingKeys,
  readOnly,
  lockedKeys,
  onOpenComments,
  commentCountsByField,
}: IDetailExtraFieldRowsProps) {
  const { t } = useTranslation();

  function formatFor(config: IEditFieldConfig): ((value: unknown) => string) | undefined {
    if (config.inputType === 'datetime') return (v) => fmt(v as string | null);
    if (config.inputType === 'date') return (v) => fmtDate(v as string | null);
    if (config.inputType === 'yes_no') {
      return (v) => (v === true ? t('common.yes') : v === false ? t('common.no') : '—');
    }
    return undefined;
  }

  return (
    <div>
      {fields.map((config) => (
        <DetailFieldRow
          key={config.key}
          shipment={shipment}
          config={config}
          readOnly={readOnly || !!lockedKeys?.has(config.key)}
          format={formatFor(config)}
          isMissing={missingKeys.has(config.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(config.key) : undefined}
          commentCount={commentCountsByField?.[config.key] ?? 0}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Completeness wiring**

In `components/shipment/ShipmentFieldGroup.tsx`, import `DETAIL_EXTRA_FIELDS` alongside `EDIT_FIELD_GROUPS` and replace `countMissing`:

```ts
/** How many of a card's fields (its group plus its Detail-only extras) the backend reports as still owed. */
export function countMissing(groupKey: IEditFieldGroup['key'], missingKeys: Set<string>): number {
  return [...groupByKey(groupKey).fields, ...DETAIL_EXTRA_FIELDS[groupKey]]
    .filter((f) => missingKeys.has(f.key)).length;
}
```

In `components/shipment/ShipmentCompletenessBar.helpers.ts`:

```ts
import { DETAIL_EXTRA_FIELDS, EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
```

```ts
export const EDITABLE_FIELD_KEYS: ReadonlySet<string> = new Set(
  [...EDIT_FIELD_GROUPS, ...Object.values(DETAIL_EXTRA_FIELDS).map((fields) => ({ fields }))]
    .flatMap((group) => group.fields.map((field) => field.key)),
);
```

Replace `SECTION_ANCHOR_BY_KEY` with:

```ts
const SECTION_ANCHOR_BY_KEY: Record<string, string> = {
  firm_splits: 'section-sale',
  sales_report: 'section-sale',
  'sales_report.approved_at': 'section-sale',
  block_sources: 'section-block-sources',
  // Spec 2026-09-30-shipment-detail-full §5: no editable row, but a place to go.
  trip_id: 'detail-field-trip_id',
  packing_template: 'detail-field-packing_template',
  has_current_advance: 'detail-field-has_current_advance',
  'quality.azyk_maglumatnama': 'detail-field-quality.azyk_maglumatnama',
  'quality.suriji_gozukdiriji': 'detail-field-quality.suriji_gozukdiriji',
  'quality.hil_sertifikaty': 'detail-field-quality.hil_sertifikaty',
  'quality.kalibrowka_analiz': 'detail-field-quality.kalibrowka_analiz',
};
```

Update the doc comments on `EDITABLE_FIELD_KEYS` / `SECTION_ANCHOR_BY_KEY` that say "AD-1 timestamps written only by transition_to()": AD-1 is retired and those timestamps are now DETAIL_EXTRA_FIELDS rows; the remaining non-anchored informational key is `shipment_code` (system-filled).

In `ShipmentCompletenessBar.test.tsx`, the test "renders a non-editable AD-1 key as a muted, non-clickable informational chip" uses `departed_at`, which is now editable. Change its key to `shipment_code`, its comment to "system-filled, no row and no anchor", and its chip lookup to `screen.getByText(i18n.t('shipment_edit_drawer.field.shipment_code', { defaultValue: 'shipment_code' }))` (import `i18n` from `@/i18n` if the file does not already).

- [ ] **Step 8: i18n**

Inside the top-level `"shipment_detail"` object of each locale, add a `"parts"` object (Edit tool, next to an existing key):

`en.json`:
```json
    "parts": {
      "choose_trip": "Choose trip",
      "choose_trip_title": "Planning trip for this shipment",
      "no_free_trips": "No free trips",
      "need_country": "Set the country first",
      "trip_linked": "Trip linked",
      "trip_unlinked": "Trip unlinked",
      "swap_title": "Swap packing with…",
      "swap_empty": "No other shipment with packing before loading",
      "truck_plate_2": "Truck plate 2",
      "driver_2_name": "Driver 2",
      "driver_2_phone": "Driver 2 phone",
      "harvest_by_block": "by block",
      "documents_title": "Documents — print",
      "documents_no_firm": "Documents appear once an export firm is chosen"
    },
```

`ru.json`:
```json
    "parts": {
      "choose_trip": "Выбрать рейс",
      "choose_trip_title": "Рейс Planning для отгрузки",
      "no_free_trips": "Свободных рейсов нет",
      "need_country": "Сначала укажите страну",
      "trip_linked": "Рейс привязан",
      "trip_unlinked": "Рейс отвязан",
      "swap_title": "Поменять упаковку с…",
      "swap_empty": "Нет других отгрузок с упаковкой до погрузки",
      "truck_plate_2": "Номер машины 2",
      "driver_2_name": "Водитель 2",
      "driver_2_phone": "Телефон водителя 2",
      "harvest_by_block": "по блокам",
      "documents_title": "Документы — печать",
      "documents_no_firm": "Документы появятся после выбора экспортной фирмы"
    },
```

`tk.json`:
```json
    "parts": {
      "choose_trip": "Reýs saýla",
      "choose_trip_title": "Ýük üçin Planning reýsi",
      "no_free_trips": "Boş reýs ýok",
      "need_country": "Ilki ýurdy görkeziň",
      "trip_linked": "Reýs baglandy",
      "trip_unlinked": "Reýs aýryldy",
      "swap_title": "Gaplamany çalyş…",
      "swap_empty": "Ýüklemeden öň gaplamaly başga ýük ýok",
      "truck_plate_2": "Maşyn belgisi 2",
      "driver_2_name": "Sürüji 2",
      "driver_2_phone": "Sürüji 2 telefony",
      "harvest_by_block": "bloklar boýunça",
      "documents_title": "Resminamalar — çap",
      "documents_no_firm": "Eksport firmasy saýlanandan soň resminamalar peýda bolar"
    },
```

Validate: `cd frontend && node -e "['en','ru','tk'].forEach(l=>JSON.parse(require('fs').readFileSync('src/i18n/'+l+'.json','utf8')))"` (exit 0).

- [ ] **Step 9: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/DetailExtraFieldRows.test.tsx src/components/shipment/ShipmentCompletenessBar.test.tsx src/components/shipment/DetailFieldRow.test.tsx src/components/ShipmentEditDrawer.test.tsx && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: all PASS, tsc exit 0.

- [ ] **Step 10: Commit** (only if approved)

```bash
git status
git add frontend/src/types/index.ts frontend/src/mock/shipmentDetail.ts frontend/src/constants/shipmentEditConfig.ts frontend/src/components/FieldEditor.tsx frontend/src/components/shipment/DetailFieldRow.helpers.ts frontend/src/components/shipment/DetailExtraFieldRows.tsx frontend/src/components/shipment/DetailExtraFieldRows.test.tsx frontend/src/components/shipment/ShipmentFieldGroup.tsx frontend/src/components/shipment/ShipmentCompletenessBar.helpers.ts frontend/src/components/shipment/ShipmentCompletenessBar.test.tsx frontend/src/i18n/en.json frontend/src/i18n/ru.json frontend/src/i18n/tk.json
git diff --cached --stat
git commit -m "feat(frontend): detail extra-field rows, yes/no editor and completeness anchors"
```

---

### Task 3: Transport part — choose / unlink a Planning trip on Detail

**Files:**
- Create: `frontend/src/components/shipment/tripAccess.ts`
- Create: `frontend/src/components/shipment/TripPickerModal.tsx`
- Create: `frontend/src/components/shipment/TripPickerModal.test.tsx`
- Modify: `frontend/src/components/shipment/ShipmentTripBanner.tsx` (+ `ShipmentTripBanner.test.tsx`)
- Modify: `frontend/src/hooks/useExternalTrips.ts` (`useTripAction` onSuccess)
- Modify: `frontend/src/components/shipment/ShipmentTransportBody.tsx`
- Modify: `frontend/src/components/shipment/ShipmentTransportBody.tripLock.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `DETAIL_EXTRA_FIELDS.transport`, `SECOND_RIG_KEYS`, `DetailExtraFieldRows` (Task 2); `useExternalTrips`, `useAssignTrip`, `useUnassignTrip` (`@/hooks/useExternalTrips`); `apiErrorKey` (`@/pages/export/truckBoard/truckBoardHelpers`); `canDo`, `canSeePage` (`@/utils/permissions`).
- Produces: `canManageTrips(user: ICurrentUser | null): boolean`; `tripCountryMismatch(tripCountry: string | null, shipmentCountry: string | null): boolean`; `TripPickerModal({ shipment: Pick<IShipmentDetail, 'id' | 'country_code'>; onClose: () => void })`; `ShipmentTripBanner` gains optional prop `canUnlink?: boolean`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/shipment/TripPickerModal.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import i18n from '@/i18n';
import * as trips from '@/hooks/useExternalTrips';
import { TripPickerModal, tripCountryMismatch } from './TripPickerModal';

vi.mock('@/hooks/useExternalTrips');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const trip = (id: number, plate: string, country: string | null) => ({
  id, tractor_plate: plate, trailer_plate: `${plate}-T`, destination_country_code: country,
  driver_full_name: `Driver ${id}`, planned_departure: '2026-10-01T06:00:00Z',
});

function setup(list: object[]) {
  const mutate = vi.fn();
  vi.mocked(trips.useExternalTrips).mockReturnValue({ data: list, isLoading: false } as any);
  vi.mocked(trips.useAssignTrip).mockReturnValue({ mutate, isPending: false } as any);
  render(<TripPickerModal shipment={{ id: 9, country_code: 'KZ' }} onClose={vi.fn()} />);
  return mutate;
}

describe('TripPickerModal', () => {
  it('flags a trip to another country as a mismatch', () => {
    expect(tripCountryMismatch('RU', 'KZ')).toBe(true);
    expect(tripCountryMismatch('KZ', 'KZ')).toBe(false);
    expect(tripCountryMismatch(null, 'KZ')).toBe(false);
  });

  it('disables a mismatched trip and assigns a matching one', () => {
    const mutate = setup([trip(1, '01AA', 'RU'), trip(2, '02BB', 'KZ')]);
    expect(screen.getByRole('radio', { name: /01AA/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /02BB/ }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('truck_board.assign') }));
    expect(mutate).toHaveBeenCalledWith(
      { tripId: 2, shipmentId: 9, confirmUnknownCountry: false }, expect.anything(),
    );
  });

  it('unknown country asks first, then sends the confirm flag', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    const mutate = setup([trip(3, '03CC', null)]);
    fireEvent.click(screen.getByRole('radio', { name: /03CC/ }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('truck_board.assign') }));
    expect(confirm).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(
      { tripId: 3, shipmentId: 9, confirmUnknownCountry: true }, expect.anything(),
    );
    confirm.mockRestore();
  });

  it('says so when there is no free trip', () => {
    setup([]);
    expect(screen.getByText(i18n.t('shipment_detail.parts.no_free_trips'))).toBeInTheDocument();
  });
});
```

Rewrite `frontend/src/components/shipment/ShipmentTransportBody.tripLock.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentTransportBody } from './ShipmentTransportBody';
import { canManageTrips } from './tripAccess';
import type { IShipmentDetail } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('./tripAccess', () => ({ canManageTrips: vi.fn(() => true) }));
vi.mock('@/components/shipment/ShipmentTripBanner', () => ({
  ShipmentTripBanner: ({ canUnlink }: { canUnlink?: boolean }) => <div>banner canUnlink={String(!!canUnlink)}</div>,
}));
vi.mock('@/components/shipment/TripPickerModal', () => ({ TripPickerModal: () => <div>trip-picker</div> }));
vi.mock('@/components/shipment/DetailFieldRow', () => ({
  DetailFieldRow: ({ config, readOnly }: { config: { key: string }; readOnly?: boolean }) => (
    <div>row {config.key} readOnly={String(!!readOnly)}</div>
  ),
}));
vi.mock('@/components/shipment/ShipmentFieldGroup', () => ({
  ShipmentFieldGroup: ({ lockedKeys }: { lockedKeys?: readonly string[] }) => (
    <div>group-locked={(lockedKeys ?? []).join(',')}</div>
  ),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderBody(over: Partial<IShipmentDetail> = {}, readOnly = false) {
  const shipment = {
    id: 1, is_gapy_satys: false, trip_id: null, driver_passport_expiry: null,
    status_code: 'draft', country_code: 'KZ', ...over,
  } as unknown as IShipmentDetail;
  return render(<ShipmentTransportBody shipment={shipment} missingKeys={new Set()} readOnly={readOnly} />);
}

const chooseLabel = () => i18n.t('shipment_detail.parts.choose_trip');

describe('ShipmentTransportBody — transport part', () => {
  it('offers «choose trip» on a regular draft without a trip and opens the picker', () => {
    renderBody();
    fireEvent.click(screen.getByRole('button', { name: chooseLabel() }));
    expect(screen.getByText('trip-picker')).toBeInTheDocument();
  });

  it('keeps truck and driver read-only on a regular shipment (no TIR selectors)', () => {
    renderBody();
    expect(screen.getByText('row truck_plate readOnly=true')).toBeInTheDocument();
    expect(screen.getByText('row driver_name readOnly=true')).toBeInTheDocument();
  });

  it('disables «choose trip» until the country is set', () => {
    renderBody({ country_code: null });
    expect(screen.getByRole('button', { name: chooseLabel() })).toBeDisabled();
  });

  it('no choose button after draft', () => {
    renderBody({ status_code: 'gumruk_girish' });
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
  });

  it('no trip actions without the truck-board grant or in read-only', () => {
    vi.mocked(canManageTrips).mockReturnValueOnce(false);
    renderBody();
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
    renderBody({}, true);
    expect(screen.getAllByText('banner canUnlink=false').length).toBeGreaterThan(0);
  });

  it('with a trip: no choose button, unlink offered, trip fields and second rig locked', () => {
    const { container } = renderBody({ trip_id: 5 });
    expect(screen.queryByRole('button', { name: chooseLabel() })).toBeNull();
    expect(screen.getByText('banner canUnlink=true')).toBeInTheDocument();
    expect(screen.getByText(/group-locked=.*driver_phone/)).toBeInTheDocument();
    expect(screen.getByText('row truck_plate_2 readOnly=true')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-trip_id')).not.toBeNull();
  });

  it('gapy: editable truck and driver, no trip block', () => {
    const { container } = renderBody({ is_gapy_satys: true });
    expect(screen.getByText('row truck_plate readOnly=false')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-trip_id')).toBeNull();
  });
});
```

In `ShipmentTripBanner.test.tsx`, add `import { Modal } from 'antd';`, change `renderBanner` to accept `canUnlink = false`, mock the new hook, and add a test:

```tsx
function renderBanner(trip: object | null, canUnlink = false) {
  vi.mocked(trips.useShipmentTrip).mockReturnValue({ data: trip } as any);
  vi.mocked(trips.useAcceptTripChange).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  const unassign = { mutate: vi.fn(), isPending: false };
  vi.mocked(trips.useUnassignTrip).mockReturnValue(unassign as any);
  const view = render(<ShipmentTripBanner shipmentId={7} canEdit canUnlink={canUnlink} />);
  return { ...view, unassign };
}
```

```tsx
  it('unlinks after confirmation when allowed', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    const { unassign } = renderBanner(
      { id: 3, trip_number: 'T1', status: 'PLANNED', conflict_kind: null, last_push_error: null }, true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(unassign.mutate).toHaveBeenCalledWith({ tripId: 3 }, expect.anything());
    confirm.mockRestore();
  });

  it('hides unlink without the right', () => {
    renderBanner({ id: 3, trip_number: 'T1', status: 'PLANNED', conflict_kind: null, last_push_error: null });
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
  });
```

(add `fireEvent` to the `@testing-library/react` import; the existing `renderBanner(null)` test destructures nothing and keeps working because `render`'s result is spread.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/shipment/TripPickerModal.test.tsx src/components/shipment/ShipmentTransportBody.tripLock.test.tsx src/components/shipment/ShipmentTripBanner.test.tsx`
Expected: FAIL — `./TripPickerModal` and `./tripAccess` do not exist; banner has no Unlink button.

- [ ] **Step 3: tripAccess**

`frontend/src/components/shipment/tripAccess.ts`:

```ts
import { canDo, canSeePage } from '@/utils/permissions';
import type { ICurrentUser } from '@/types';

/**
 * Choose / unlink a Planning trip from the Detail page. Mirrors the backend
 * gates on /transport/external-trips/: CanViewTruckBoard (the trip list is a
 * Truck Board read) AND CanAssignTrips (shipment_assign.edit).
 */
export function canManageTrips(user: ICurrentUser | null): boolean {
  return canSeePage(user, 'export.truck_board') && canDo(user, 'shipment_assign', 'edit');
}
```

- [ ] **Step 4: TripPickerModal**

`frontend/src/components/shipment/TripPickerModal.tsx`:

```tsx
import { useState } from 'react';
import { Empty, List, Modal, Radio, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAssignTrip, useExternalTrips } from '@/hooks/useExternalTrips';
import { apiErrorKey } from '@/pages/export/truckBoard/truckBoardHelpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { FONT } from '@/constants/styles';
import type { IShipmentDetail } from '@/types';

/** A trip bound for another country can't take this shipment; an unknown country can, after a confirm. */
export function tripCountryMismatch(tripCountry: string | null, shipmentCountry: string | null): boolean {
  return tripCountry !== null && tripCountry !== shipmentCountry;
}

interface ITripPickerModalProps {
  readonly shipment: Pick<IShipmentDetail, 'id' | 'country_code'>;
  readonly onClose: () => void;
}

/**
 * Pick a free Planning trip for this shipment (spec 2026-09-30 §1) — the same
 * assign the Truck Board does. Mount it only while open: the free-trip list
 * polls every 60 s.
 */
export function TripPickerModal({ shipment, onClose }: ITripPickerModalProps) {
  const { t } = useTranslation();
  const { data: trips = [], isLoading } = useExternalTrips({ free: true });
  const assign = useAssignTrip();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = trips.find((trip) => trip.id === selectedId) ?? null;

  function submit(confirmUnknownCountry: boolean) {
    if (!selected) return;
    assign.mutate(
      { tripId: selected.id, shipmentId: shipment.id, confirmUnknownCountry },
      {
        onSuccess: () => { toast.success(t('shipment_detail.parts.trip_linked')); onClose(); },
        onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
      },
    );
  }

  function handleOk() {
    if (!selected) return;
    if (selected.destination_country_code === null) {
      Modal.confirm({ title: t('truck_board.unknown_country_confirm'), onOk: () => submit(true) });
      return;
    }
    submit(false);
  }

  return (
    <Modal
      open
      title={t('shipment_detail.parts.choose_trip_title')}
      onCancel={onClose}
      onOk={handleOk}
      okText={t('truck_board.assign')}
      okButtonProps={{ disabled: selected === null }}
      confirmLoading={assign.isPending}
      destroyOnHidden
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : trips.length === 0 ? (
        <Empty description={t('shipment_detail.parts.no_free_trips')} />
      ) : (
        <Radio.Group value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))} style={{ width: '100%' }}>
          <List
            dataSource={trips}
            renderItem={(trip) => {
              const mismatch = tripCountryMismatch(trip.destination_country_code, shipment.country_code);
              return (
                <List.Item key={trip.id}>
                  <Radio value={trip.id} disabled={mismatch} style={{ width: '100%' }}>
                    <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                      {trip.tractor_plate} / {trip.trailer_plate}
                    </Typography.Text>
                    <span style={{ marginLeft: 8, fontSize: 12 }}>
                      {trip.destination_country_code ?? '—'} · {trip.driver_full_name} · {fmt(trip.planned_departure)}
                    </span>
                    {mismatch && <Tag color="red" style={{ marginLeft: 8 }}>{t('truck_board.country_mismatch')}</Tag>}
                  </Radio>
                </List.Item>
              );
            }}
          />
        </Radio.Group>
      )}
    </Modal>
  );
}
```

- [ ] **Step 5: Detail refreshes after a trip action**

In `hooks/useExternalTrips.ts`, inside `useTripAction`'s `onSuccess`, add one line after `queryClient.invalidateQueries({ queryKey: ['shipments'] });`:

```ts
      // Shipment detail keys are ['shipment', id] — trip_id and the transport fields changed.
      queryClient.invalidateQueries({ queryKey: ['shipment'] });
```

- [ ] **Step 6: Banner unlink**

In `ShipmentTripBanner.tsx`:
- import `Modal` from antd and `useUnassignTrip` from `@/hooks/useExternalTrips`;
- props: add `/** Show «Отвязать» (caller checked canManageTrips and read-only). */ canUnlink?: boolean;` and destructure `canUnlink = false`;
- after `const accept = useAcceptTripChange();` add `const unassign = useUnassignTrip();`;
- add this function after `openPdf`:

```tsx
  const confirmUnlink = () => Modal.confirm({
    title: t('truck_board.unlink_confirm'),
    okText: t('packing.confirm_ok'),
    cancelText: t('packing.confirm_cancel'),
    onOk: () => unassign.mutate({ tripId: trip.id }, {
      onSuccess: () => toast.success(t('shipment_detail.parts.trip_unlinked')),
      onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
    }),
  });
```

- in the first `<Space>` after the PDF button add:

```tsx
        {canUnlink && (
          <Button size="small" danger loading={unassign.isPending} onClick={confirmUnlink}>
            {t('truck_board.unlink')}
          </Button>
        )}
```

- [ ] **Step 7: Transport body**

Replace `ShipmentTransportBody.tsx` with:

```tsx
import { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { DetailExtraFieldRows } from '@/components/shipment/DetailExtraFieldRows';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentTripBanner } from '@/components/shipment/ShipmentTripBanner';
import { TripPickerModal } from '@/components/shipment/TripPickerModal';
import { canManageTrips } from '@/components/shipment/tripAccess';
import {
  DETAIL_EXTRA_FIELDS, DRIVER_NAME_FIELD, SECOND_RIG_KEYS, TRUCK_PLATE_FIELD,
} from '@/constants/shipmentEditConfig';
import { useAuth } from '@/hooks/useAuth';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { TRIP_LOCKED_FIELDS } from '@/utils/sheetPermissions';
import type { IShipmentDetail } from '@/types';

interface IShipmentTransportBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Transport & Transit" card = the transport part (spec 2026-09-30 §1).
 *
 * Regular shipments get their truck from a Planning trip (transport-trips
 * spec D9/D10): the trip block offers «choose» while the shipment is in
 * Preparation without a trip, and «unlink» on the banner once linked. Truck
 * and driver are then read-only here — they come from the trip (or, for
 * shipments from before trips, from the old fleet pick). Gapy-Satys keeps
 * typed-in truck and driver.
 */
export function ShipmentTransportBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentTransportBodyProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const isGapy = shipment.is_gapy_satys;
  // A Planning trip owns tractor/trailer/driver (backend PATCH refuses them with 400 trip_locked).
  const isTripLinked = !!shipment.trip_id && !isGapy;
  const canTrips = !readOnly && canManageTrips(user);
  const showChoose = canTrips && !shipment.trip_id && shipment.status_code === 'draft';

  const rowProps = (key: string) => ({
    isMissing: missingKeys.has(key),
    onOpenComments: onOpenComments ? () => onOpenComments(key) : undefined,
    commentCount: commentCountsByField?.[key] ?? 0,
  });

  return (
    <>
      {!isGapy && (
        <div id="detail-field-trip_id" style={{ marginBottom: 8 }}>
          <ShipmentTripBanner shipmentId={shipment.id} canEdit={!readOnly} canUnlink={canTrips} />
          {showChoose && (
            <Tooltip title={shipment.country_code ? undefined : t('shipment_detail.parts.need_country')}>
              <Button type="primary" size="small" disabled={!shipment.country_code} onClick={() => setPickerOpen(true)}>
                {t('shipment_detail.parts.choose_trip')}
              </Button>
            </Tooltip>
          )}
          {pickerOpen && <TripPickerModal shipment={shipment} onClose={() => setPickerOpen(false)} />}
        </div>
      )}
      <DetailFieldRow shipment={shipment} config={TRUCK_PLATE_FIELD} readOnly={readOnly || !isGapy} {...rowProps(TRUCK_PLATE_FIELD.key)} />
      <DetailFieldRow shipment={shipment} config={DRIVER_NAME_FIELD} readOnly={readOnly || !isGapy} {...rowProps(DRIVER_NAME_FIELD.key)} />
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="transport"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
        excludeKeys={[TRUCK_PLATE_FIELD.key, DRIVER_NAME_FIELD.key]}
        lockedKeys={isTripLinked ? [...TRIP_LOCKED_FIELDS] : undefined}
      />
      {isTripLinked && shipment.driver_passport_expiry && (
        <InfoRow label={t('truck_board.passport_valid_until')} value={shipment.driver_passport_expiry} />
      )}
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.transport}
        missingKeys={missingKeys}
        readOnly={readOnly}
        lockedKeys={isTripLinked ? SECOND_RIG_KEYS : undefined}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
    </>
  );
}
```

(`border_crossed_at` / `arrived_at` InfoRows are gone — they are editable rows in `DETAIL_EXTRA_FIELDS.transport` now.)

- [ ] **Step 8: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/ src/pages/export/truckBoard/ && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, tsc exit 0. (`ShipmentTruckSelector` / `ShipmentDriverSelector` stay — the Sheet editor and the Edit drawer still use them.)

- [ ] **Step 9: Commit** (only if approved)

```bash
git status
git add frontend/src/components/shipment/tripAccess.ts frontend/src/components/shipment/TripPickerModal.tsx frontend/src/components/shipment/TripPickerModal.test.tsx frontend/src/components/shipment/ShipmentTripBanner.tsx frontend/src/components/shipment/ShipmentTripBanner.test.tsx frontend/src/hooks/useExternalTrips.ts frontend/src/components/shipment/ShipmentTransportBody.tsx frontend/src/components/shipment/ShipmentTransportBody.tripLock.test.tsx
git diff --cached --stat
git commit -m "feat(frontend): choose and unlink the Planning trip on the shipment page"
```

---

### Task 4: Packaging part — unjoin / swap on Detail, goods rows cleanup, harvest date

**Files:**
- Create: `frontend/src/components/shipment/ShipmentPackingActions.tsx`
- Create: `frontend/src/components/shipment/SwapPackingModal.tsx`
- Create: `frontend/src/components/shipment/ShipmentPackingActions.test.tsx`
- Modify: `frontend/src/components/shipment/ShipmentGoodsBody.tsx` (+ `ShipmentGoodsBody.test.tsx`)

**Interfaces:**
- Consumes: `useUnjoinPackaging`, `useSwapPackaging`, `useJoinBoard` (`@/hooks/useDrafts`, import only — do not edit that file); `canUserJoin`, `isPreLoading` (`@/components/sheet/joinHelpers`); `extractPatchError` (`@/hooks/useShipmentPatch`); `DETAIL_EXTRA_FIELDS.goods`, `DetailExtraFieldRows` (Task 2).
- Produces: `ShipmentPackingActions({ shipment: IShipmentDetail; readOnly: boolean })`; `packingActions(shipment, user): { canSwap: boolean; canUnjoin: boolean }`; `swapCandidates(rows: IShipmentDraft[], currentId: number): IShipmentDraft[]`; `SwapPackingModal({ shipment: Pick<IShipmentDetail, 'id' | 'shipment_code'>; onClose: () => void })`; `GOODS_ROWS_MOVED_TO_PACKING` (not exported beyond the body).

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/shipment/ShipmentPackingActions.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import i18n from '@/i18n';
import * as drafts from '@/hooks/useDrafts';
import { ShipmentPackingActions, packingActions } from './ShipmentPackingActions';
import { swapCandidates } from './SwapPackingModal';
import type { IShipmentDetail, IShipmentDraft } from '@/types';

vi.mock('@/hooks/useDrafts');
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'export_manager' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const joinManager = { role: 'export_manager' };
const base = {
  id: 4, shipment_code: '0101004/26', status_code: 'draft', country: 1, customer: 2,
  block_sources: [{ block_code: 'A', block_name: 'A', weight_kg: 1000, harvest_date: null }],
} as unknown as IShipmentDetail;

describe('packingActions', () => {
  it('allows both before loading with packing and a destination', () => {
    expect(packingActions(base, joinManager)).toEqual({ canSwap: true, canUnjoin: true });
  });
  it('no unjoin without a customer (a supply plan — the backend refuses it)', () => {
    expect(packingActions({ ...base, customer: null }, joinManager)).toEqual({ canSwap: true, canUnjoin: false });
  });
  it('nothing after loading started, without packing, or for a role outside JOIN_ROLES', () => {
    const none = { canSwap: false, canUnjoin: false };
    expect(packingActions({ ...base, status_code: 'yuklenme' }, joinManager)).toEqual(none);
    expect(packingActions({ ...base, block_sources: [] }, joinManager)).toEqual(none);
    expect(packingActions(base, { role: 'sales_rep' })).toEqual(none);
  });
});

describe('swap candidates', () => {
  it('drops the current row, rows without packing and rows past loading', () => {
    const row = (id: number, status: string, blocks: number) => ({
      id, shipment_code: `c${id}`, status_code: status, block_sources: Array(blocks).fill({ block_code: 'A' }),
    }) as unknown as IShipmentDraft;
    const out = swapCandidates([row(4, 'draft', 1), row(5, 'draft', 0), row(6, 'yuklenme', 1), row(7, 'gumruk_girish', 1)], 4);
    expect(out.map((r) => r.id)).toEqual([7]);
  });
});

describe('ShipmentPackingActions', () => {
  function setup(readOnly = false) {
    const unjoin = { mutate: vi.fn(), isPending: false };
    vi.mocked(drafts.useUnjoinPackaging).mockReturnValue(unjoin as any);
    vi.mocked(drafts.useSwapPackaging).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(drafts.useJoinBoard).mockReturnValue({ data: [], isLoading: false } as any);
    render(<ShipmentPackingActions shipment={base} readOnly={readOnly} />);
    return unjoin;
  }

  it('unjoins after confirmation', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    const unjoin = setup();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('packing.btn_unjoin') }));
    expect(unjoin.mutate).toHaveBeenCalledWith(4, expect.anything());
    confirm.mockRestore();
  });

  it('opens the swap picker', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('packing.btn_swap') }));
    expect(screen.getByText(i18n.t('shipment_detail.parts.swap_empty'))).toBeInTheDocument();
  });

  it('renders nothing read-only', () => {
    setup(true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

Add to `ShipmentGoodsBody.test.tsx` (top-level, after the existing `vi.mock('@/services/api', …)`):

```tsx
vi.mock('@/components/shipment/ShipmentPackingActions', () => ({ ShipmentPackingActions: () => null }));
vi.mock('@/components/shipment/VarietyOverrideRow', () => ({ VarietyOverrideRow: () => null }));
```

and a new describe block at the end of the file:

```tsx
function renderGoods(over: Partial<IShipmentDetail>) {
  const shipment: IShipmentDetail = { ...MOCK_SHIPMENT_DETAIL, ...over };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ShipmentGoodsBody shipment={shipment} missingKeys={new Set()} readOnly={false} canOverrideVariety={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ShipmentGoodsBody — packaging part rows', () => {
  it('drops gross / tare / pallets / boxes (the packing panel owns them) and keeps net', () => {
    const { container } = renderGoods({});
    for (const key of ['weight_gross', 'packaging_kg', 'pallet_count', 'box_count']) {
      expect(container.querySelector(`#detail-field-${key}`)).toBeNull();
    }
    expect(container.querySelector('#detail-field-weight_net')).not.toBeNull();
    expect(container.querySelector('#detail-field-loading_started_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-loading_ended_at')).not.toBeNull();
  });

  it('harvest date: block dates win and are read-only', () => {
    const { container } = renderGoods({
      harvest_date: '5-10 oktýabr',
      block_sources: [{ block_code: 'A', block_name: 'A', weight_kg: 1000, harvest_date: '2026-09-21' }],
    });
    const row = container.querySelector('#detail-field-harvest_date') as HTMLElement;
    expect(within(row).getByText(new RegExp(fmtDate('2026-09-21')))).toBeInTheDocument();
    expect(within(row).queryByText('5-10 oktýabr')).toBeNull();
  });

  it('harvest date: the shipment text when blocks carry no date', () => {
    const { container } = renderGoods({ harvest_date: '5-10 oktýabr', block_sources: [] });
    const row = container.querySelector('#detail-field-harvest_date') as HTMLElement;
    expect(within(row).getByText('5-10 oktýabr')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentPackingActions.test.tsx src/components/shipment/ShipmentGoodsBody.test.tsx`
Expected: FAIL — modules missing; `#detail-field-weight_gross` still rendered.

- [ ] **Step 3: SwapPackingModal**

`frontend/src/components/shipment/SwapPackingModal.tsx`:

```tsx
import { useState } from 'react';
import { Empty, List, Modal, Radio, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useJoinBoard, useSwapPackaging } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { isPreLoading } from '@/components/sheet/joinHelpers';
import { FONT } from '@/constants/styles';
import type { IShipmentDetail, IShipmentDraft } from '@/types';

/** Rows this shipment may swap packing with — mirrors the backend swap_packing gates minus pallets/role. */
export function swapCandidates(rows: IShipmentDraft[], currentId: number): IShipmentDraft[] {
  return rows.filter((r) => r.id !== currentId
    && r.block_sources.length > 0
    && isPreLoading(r.status_code ?? ''));
}

interface ISwapPackingModalProps {
  readonly shipment: Pick<IShipmentDetail, 'id' | 'shipment_code'>;
  readonly onClose: () => void;
}

/** Pick the other truck; the two rows exchange their packing (spec 2026-09-29, Detail entry point 2026-09-30). */
export function SwapPackingModal({ shipment, onClose }: ISwapPackingModalProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useJoinBoard();
  const swap = useSwapPackaging();
  const [otherId, setOtherId] = useState<number | null>(null);
  const candidates = swapCandidates(rows, shipment.id);
  const other = candidates.find((r) => r.id === otherId) ?? null;

  function handleOk() {
    if (!other) return;
    Modal.confirm({
      title: t('packing.confirm_swap_title'),
      content: t('packing.confirm_swap_body', { a: shipment.shipment_code, b: other.shipment_code }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: () => swap.mutate(
        { aId: shipment.id, otherId: other.id },
        {
          onSuccess: () => { toast.success(t('packing.toast_swapped')); onClose(); },
          onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
        },
      ),
    });
  }

  return (
    <Modal
      open
      title={t('shipment_detail.parts.swap_title')}
      onCancel={onClose}
      onOk={handleOk}
      okText={t('packing.btn_swap')}
      okButtonProps={{ disabled: other === null }}
      confirmLoading={swap.isPending}
      destroyOnHidden
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : candidates.length === 0 ? (
        <Empty description={t('shipment_detail.parts.swap_empty')} />
      ) : (
        <Radio.Group value={otherId} onChange={(e) => setOtherId(Number(e.target.value))} style={{ width: '100%' }}>
          <List
            dataSource={candidates}
            renderItem={(r) => (
              <List.Item key={r.id}>
                <Radio value={r.id}>
                  <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>{r.shipment_code}</Typography.Text>
                  <span style={{ marginLeft: 8, fontSize: 12 }}>
                    {r.block_sources.map((b) => b.block_code).join(', ')}
                    {r.weight_net != null && ` · ${Number(r.weight_net).toLocaleString('ru-RU')} kg`}
                  </span>
                </Radio>
              </List.Item>
            )}
          />
        </Radio.Group>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: ShipmentPackingActions**

`frontend/src/components/shipment/ShipmentPackingActions.tsx`:

```tsx
import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUnjoinPackaging } from '@/hooks/useDrafts';
import { useAuth } from '@/hooks/useAuth';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { canUserJoin, isPreLoading } from '@/components/sheet/joinHelpers';
import { SwapPackingModal } from '@/components/shipment/SwapPackingModal';
import type { IShipmentDetail } from '@/types';

type PackingSubject = Pick<IShipmentDetail, 'status_code' | 'block_sources' | 'country' | 'customer'>;

/**
 * Which packing moves this user may start from the Detail page. Mirrors the
 * backend (services/packaging.py): before loading, the row has packing, a
 * JOIN_ROLES user; unjoin also needs a destination — a supply plan has
 * nothing to detach from.
 */
export function packingActions(
  shipment: PackingSubject,
  user: { role?: string | null; is_superuser?: boolean } | null,
): { canSwap: boolean; canUnjoin: boolean } {
  const canSwap = canUserJoin(user) && isPreLoading(shipment.status_code) && shipment.block_sources.length > 0;
  return { canSwap, canUnjoin: canSwap && shipment.country != null && shipment.customer != null };
}

interface IShipmentPackingActionsProps {
  shipment: IShipmentDetail;
  readOnly: boolean;
}

/** «Отсоединить» / «Поменять упаковку» for the packaging part (spec 2026-09-30 §2). */
export function ShipmentPackingActions({ shipment, readOnly }: IShipmentPackingActionsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unjoin = useUnjoinPackaging();
  const [swapOpen, setSwapOpen] = useState(false);
  const { canSwap, canUnjoin } = packingActions(shipment, user);
  if (readOnly || !canSwap) return null;

  const confirmUnjoin = () => Modal.confirm({
    title: t('packing.confirm_unjoin_title'),
    content: t('packing.confirm_unjoin_body', { a: shipment.shipment_code }),
    okText: t('packing.confirm_ok'),
    cancelText: t('packing.confirm_cancel'),
    onOk: () => unjoin.mutate(shipment.id, {
      onSuccess: (data) => toast.success(t('packing.toast_unjoined', { code: data.new_supply_code })),
      onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
    }),
  });

  return (
    <Space style={{ margin: '6px 0' }}>
      {canUnjoin && (
        <Button size="small" loading={unjoin.isPending} onClick={confirmUnjoin}>{t('packing.btn_unjoin')}</Button>
      )}
      <Button size="small" onClick={() => setSwapOpen(true)}>{t('packing.btn_swap')}</Button>
      {swapOpen && <SwapPackingModal shipment={shipment} onClose={() => setSwapOpen(false)} />}
    </Space>
  );
}
```

- [ ] **Step 5: Goods body**

In `ShipmentGoodsBody.tsx`:

1. Add imports: `import { DetailExtraFieldRows } from '@/components/shipment/DetailExtraFieldRows';`, `import { ShipmentPackingActions } from '@/components/shipment/ShipmentPackingActions';`, and add `DETAIL_EXTRA_FIELDS, type IEditFieldConfig` to the `@/constants/shipmentEditConfig` import.
2. Above the component add:

```tsx
/**
 * Gross / tare / pallets / boxes are entered in the packing panel (Documents
 * card) since 2026-09-30 — the CMR reads the packing template first, so an
 * edit here was silently ignored. Hidden on Detail only; EDIT_FIELD_GROUPS
 * keeps them for the Edit drawer, and the pallet manifest still writes them.
 */
const GOODS_ROWS_MOVED_TO_PACKING = ['weight_gross', 'packaging_kg', 'pallet_count', 'box_count'] as const;

/** Shipment.harvest_date is free text («5-10 oktýabr»), separate from the per-block batch dates. */
const HARVEST_DATE_FIELD: IEditFieldConfig = {
  key: 'harvest_date', labelKey: 'sheet.row.harvest_date', inputType: 'text',
};
```

3. Right after the `<div id="section-block-sources">…</div>` block add:

```tsx
      <ShipmentPackingActions shipment={shipment} readOnly={readOnly} />
```

4. Change the goods `ShipmentFieldGroup`'s `excludeKeys` to `[HARVEST_STATUS_FIELD.key, ...GOODS_ROWS_MOVED_TO_PACKING]`.
5. Replace the last line `<InfoRow label={t('shipment_detail.harvest_date')} value={fmtDate(shipment.date)} />` with:

```tsx
      {/* Same precedence as Sheet R39: the blocks' batch dates first, then the
          shipment's own text. `shipment.date` is the shipment date — a different field. */}
      {blockHarvestDates.length > 0 ? (
        <div id="detail-field-harvest_date">
          <InfoRow
            label={t('sheet.row.harvest_date')}
            value={`${blockHarvestDates.map(fmtDate).join(', ')} (${t('shipment_detail.parts.harvest_by_block')})`}
          />
        </div>
      ) : (
        <DetailFieldRow
          shipment={shipment}
          config={HARVEST_DATE_FIELD}
          readOnly={readOnly}
          isMissing={missingKeys.has(HARVEST_DATE_FIELD.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(HARVEST_DATE_FIELD.key) : undefined}
          commentCount={commentCountsByField?.[HARVEST_DATE_FIELD.key] ?? 0}
        />
      )}
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.goods}
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
```

6. Next to `const blockDisplay = …` add:

```tsx
  const blockHarvestDates = [...new Set(
    shipment.block_sources.map((b) => b.harvest_date).filter((d): d is string => d != null),
  )].sort();
```

7. Update the component doc comment: harvest date is now Sheet R39's value; loading start/end rows and the packing actions live here; gross/tare/pallets/boxes moved to the packing panel.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/ && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, tsc exit 0. If `ShipmentGoodsBody.test.tsx`'s existing block-sources tests break because of the new mocks, the fix is in the mock setup, not in the component.

- [ ] **Step 7: Commit** (only if approved)

```bash
git status
git add frontend/src/components/shipment/ShipmentPackingActions.tsx frontend/src/components/shipment/SwapPackingModal.tsx frontend/src/components/shipment/ShipmentPackingActions.test.tsx frontend/src/components/shipment/ShipmentGoodsBody.tsx frontend/src/components/shipment/ShipmentGoodsBody.test.tsx
git diff --cached --stat
git commit -m "feat(frontend): unjoin and swap packing on the shipment page; harvest date as on the Sheet"
```

---

### Task 5: Export part — packing panel, contracts panel, documents and sale rows

**Files:**
- Modify: `frontend/src/components/sheet/ShipmentPackingPanel.tsx` (optional `width` prop)
- Modify: `frontend/src/components/shipment/ShipmentDocumentsBody.tsx`
- Modify: `frontend/src/components/shipment/ShipmentDestinationBody.tsx`
- Modify: `frontend/src/components/shipment/ShipmentSaleSection.tsx`
- Create: `frontend/src/components/shipment/ShipmentExportPart.test.tsx`

**Interfaces:**
- Consumes: `ShipmentPackingPanel({ shipmentId, width? })`, `ShipmentFirmContractsPanel({ shipmentId })` (`@/components/sheet/…`); `DETAIL_EXTRA_FIELDS.status` / `.finance`, `DetailExtraFieldRows` (Task 2); `shipment.has_current_advance`, `shipment.packing_template_name` (Task 1/2).
- Produces: element ids `#detail-field-packing_template`, `#detail-field-has_current_advance`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/shipment/ShipmentExportPart.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ShipmentDocumentsBody } from './ShipmentDocumentsBody';
import { ShipmentDestinationBody } from './ShipmentDestinationBody';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({ default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => <div>packing-panel</div> }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({
  ShipmentFirmContractsPanel: () => <div>contracts-panel</div>,
}));
vi.mock('@/components/shipment/ShipmentFirmSelector', () => ({ ShipmentFirmSelector: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const withFirm = (over: Partial<IShipmentDetail> = {}): IShipmentDetail => ({
  ...MOCK_SHIPMENT_DETAIL,
  firm_splits: [{ export_firm_id: 1, export_firm_name: 'YGT', weight_kg: 1000, amount_usd: null, invoice_number: null }],
  ...over,
} as IShipmentDetail);

describe('Documents card — export part', () => {
  it('embeds the packing panel under the packing_template anchor', () => {
    const { container } = wrap(<ShipmentDocumentsBody shipment={withFirm()} missingKeys={new Set()} readOnly={false} />);
    const anchor = container.querySelector('#detail-field-packing_template') as HTMLElement;
    expect(within(anchor).getByText('packing-panel')).toBeInTheDocument();
  });

  it('read-only shows the template name instead of the panel', () => {
    wrap(<ShipmentDocumentsBody shipment={withFirm({ packing_template_name: '2 firms 20t' })} missingKeys={new Set()} readOnly />);
    expect(screen.queryByText('packing-panel')).toBeNull();
    expect(screen.getByText('2 firms 20t')).toBeInTheDocument();
  });

  it('shows the advance answer and the customs rows', () => {
    const { container } = wrap(
      <ShipmentDocumentsBody shipment={withFirm({ has_current_advance: true })} missingKeys={new Set()} readOnly={false} />,
    );
    const advance = container.querySelector('#detail-field-has_current_advance') as HTMLElement;
    expect(within(advance).getByText(i18n.t('common.yes'))).toBeInTheDocument();
    expect(container.querySelector('#detail-field-customs_exit_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-document_note')).not.toBeNull();
  });
});

describe('Destination card — contracts', () => {
  it('shows the contracts panel once a firm is chosen', () => {
    wrap(<ShipmentDestinationBody shipment={withFirm()} missingKeys={new Set()} readOnly={false} />);
    expect(screen.getByText('contracts-panel')).toBeInTheDocument();
  });

  it('no panel without firms or in read-only', () => {
    wrap(<ShipmentDestinationBody shipment={withFirm({ firm_splits: [] })} missingKeys={new Set()} readOnly={false} />);
    expect(screen.queryByText('contracts-panel')).toBeNull();
    wrap(<ShipmentDestinationBody shipment={withFirm()} missingKeys={new Set()} readOnly />);
    expect(screen.queryByText('contracts-panel')).toBeNull();
  });
});
```

If `IFirmSplit` has more required fields than the literal above, `tsc` will name them — copy the missing ones from `MOCK_SHIPMENT_DETAIL.firm_splits` shape in `mock/shipmentDetail.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentExportPart.test.tsx`
Expected: FAIL — no `#detail-field-packing_template`, no contracts panel.

- [ ] **Step 3: Packing panel width**

In `components/sheet/ShipmentPackingPanel.tsx`:

```tsx
interface IProps {
  shipmentId: number;
  /** Sheet cell popover = 380px (default); the Detail card passes '100%'. */
  width?: number | string;
}
```

```tsx
export function ShipmentPackingPanel({ shipmentId, width = 380 }: IProps) {
```

and in the root `<div style={…}>` change `width: 380` to `width`.

- [ ] **Step 4: Documents body**

Replace `ShipmentDocumentsBody.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { DetailExtraFieldRows } from '@/components/shipment/DetailExtraFieldRows';
import { ShipmentPackingPanel } from '@/components/sheet/ShipmentPackingPanel';
import { DETAIL_EXTRA_FIELDS } from '@/constants/shipmentEditConfig';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import type { IShipmentDetail } from '@/types';

interface IShipmentDocumentsBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * "Documents & Customs" card — the documents half of the export part (spec
 * 2026-09-30 §3): docs status and planned customs day, the documents note,
 * both customs timestamps, the advance answer (give_advance target), and the
 * packing panel — the ONE place gross / boxes / pallets are entered; the CMR
 * reads its template first.
 */
export function ShipmentDocumentsBody({
  shipment,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
}: IShipmentDocumentsBodyProps) {
  const { t } = useTranslation();

  return (
    <>
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="status"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.status}
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <div id="detail-field-has_current_advance">
        <InfoRow
          label={t('sheet.row.doc_advance')}
          value={shipment.has_current_advance ? t('common.yes') : t('common.no')}
        />
      </div>
      <div id="detail-field-packing_template" style={{ marginTop: 12 }}>
        {readOnly ? (
          <InfoRow label={t('sheet.packing.title')} value={shipment.packing_template_name ?? '—'} />
        ) : (
          <ShipmentPackingPanel shipmentId={shipment.id} width="100%" />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Destination body**

In `ShipmentDestinationBody.tsx` import `import { ShipmentFirmContractsPanel } from '@/components/sheet/ShipmentFirmContractsPanel';` and after `<ShipmentFirmSelector … />` add:

```tsx
      {/* Per-firm contract: number, link to a framework contract, one-time create, .docx. */}
      {!readOnly && shipment.firm_splits.length > 0 && (
        <ShipmentFirmContractsPanel shipmentId={shipment.id} />
      )}
```

Update the doc comment to mention the contracts panel.

- [ ] **Step 6: Sale section**

In `ShipmentSaleSection.tsx`: import `DetailExtraFieldRows` and `DETAIL_EXTRA_FIELDS`; replace the `<div style={{ marginTop: 8 }}>` block holding the two sale `InfoRow`s with:

```tsx
      <DetailExtraFieldRows
        shipment={shipment}
        fields={DETAIL_EXTRA_FIELDS.finance}
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
```

Drop `fmt` / `InfoRow` from the imports if no longer used (keep `SalesReportForm`).

- [ ] **Step 7: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/ src/components/sheet/ && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, tsc exit 0.

- [ ] **Step 8: Commit** (only if approved)

```bash
git status
git add frontend/src/components/sheet/ShipmentPackingPanel.tsx frontend/src/components/shipment/ShipmentDocumentsBody.tsx frontend/src/components/shipment/ShipmentDestinationBody.tsx frontend/src/components/shipment/ShipmentSaleSection.tsx frontend/src/components/shipment/ShipmentExportPart.test.tsx
git diff --cached --stat
git commit -m "feat(frontend): packing and contracts panels on the shipment page"
```

---

### Task 6: Notes — Sheet notes and admin custom rows

**Files:**
- Create: `frontend/src/hooks/useShipmentCustomField.ts`
- Create: `frontend/src/components/shipment/ShipmentCustomFieldRows.tsx`
- Create: `frontend/src/components/shipment/ShipmentCustomFieldRows.test.tsx`
- Modify: `frontend/src/components/shipment/ShipmentDetailStageCards.tsx` (Notes card)

**Interfaces:**
- Consumes: `IShipmentCustomField`, `DETAIL_EXTRA_FIELDS.notes`, `DetailExtraFieldRows` (Task 2); `getShipmentDetailKey` (`@/hooks/useShipmentDetail`); `PATCH /export/shipments/{id}/custom-fields/` body `{ field_key, value }`.
- Produces: `usePatchCustomField(shipmentId: number)` → mutation of `{ fieldKey: string; value: string }`; `ShipmentCustomFieldRows({ shipment: IShipmentDetail; readOnly: boolean })`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/shipment/ShipmentCustomFieldRows.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import * as hook from '@/hooks/useShipmentCustomField';
import { ShipmentCustomFieldRows } from './ShipmentCustomFieldRows';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';

vi.mock('@/hooks/useShipmentCustomField');
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const shipment = {
  ...MOCK_SHIPMENT_DETAIL,
  custom_fields: [
    { field_key: 'custom_seal', label_tk: 'Plomba', label_ru: 'Пломба', label_en: 'Seal', value: 'A-17' },
  ],
};

let mutate: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await i18n.changeLanguage('ru');
  mutate = vi.fn();
  vi.mocked(hook.usePatchCustomField).mockReturnValue({ mutate, isPending: false } as any);
});

describe('ShipmentCustomFieldRows', () => {
  it('labels the row in the UI language', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    expect(screen.getByText('Пломба')).toBeInTheDocument();
  });

  it('unchanged blur does not save', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    fireEvent.blur(screen.getByDisplayValue('A-17'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('saves a changed value on blur', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    const input = screen.getByDisplayValue('A-17');
    fireEvent.change(input, { target: { value: 'B-2' } });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledWith({ fieldKey: 'custom_seal', value: 'B-2' }, expect.anything());
  });

  it('read-only shows text, no input', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly />);
    expect(screen.getByText('A-17')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A-17')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentCustomFieldRows.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Hook**

`frontend/src/hooks/useShipmentCustomField.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';

/** PATCH /export/shipments/{id}/custom-fields/ — one admin custom row's value (free text). */
export function usePatchCustomField(shipmentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fieldKey, value }: { fieldKey: string; value: string }) => {
      await api.patch(`/export/shipments/${shipmentId}/custom-fields/`, { field_key: fieldKey, value });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(shipmentId) }),
  });
}
```

- [ ] **Step 4: Rows**

`frontend/src/components/shipment/ShipmentCustomFieldRows.tsx`:

```tsx
import { useState } from 'react';
import { Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePatchCustomField } from '@/hooks/useShipmentCustomField';
import { COLORS } from '@/constants/styles';
import type { IShipmentCustomField, IShipmentDetail } from '@/types';

const { Text } = Typography;

function labelFor(field: IShipmentCustomField, lang: string): string {
  if (lang.startsWith('ru') && field.label_ru) return field.label_ru;
  if (lang.startsWith('en') && field.label_en) return field.label_en;
  return field.label_tk || field.field_key;
}

interface IShipmentCustomFieldRowsProps {
  shipment: IShipmentDetail;
  readOnly: boolean;
}

/** Admin-created custom Sheet rows (free text), same values as the Sheet. */
export function ShipmentCustomFieldRows({ shipment, readOnly }: IShipmentCustomFieldRowsProps) {
  const { i18n } = useTranslation();
  return (
    <>
      {shipment.custom_fields.map((field) => (
        <CustomFieldRow
          key={field.field_key}
          shipmentId={shipment.id}
          field={field}
          label={labelFor(field, i18n.language)}
          readOnly={readOnly}
        />
      ))}
    </>
  );
}

function CustomFieldRow({ shipmentId, field, label, readOnly }: {
  shipmentId: number; field: IShipmentCustomField; label: string; readOnly: boolean;
}) {
  const { t } = useTranslation();
  const patch = usePatchCustomField(shipmentId);
  const [value, setValue] = useState(field.value ?? '');

  // Each PATCH writes an audit row — save only a real change.
  function save() {
    if (value === (field.value ?? '')) return;
    patch.mutate({ fieldKey: field.field_key, value }, { onError: () => toast.error(t('common.error')) });
  }

  return (
    <div
      id={`detail-field-${field.field_key}`}
      className="detail-row"
      style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f5f5f5', gap: 12 }}
    >
      <Text style={{ flex: '0 0 180px', fontSize: 13, color: COLORS.textTertiary }}>{label}</Text>
      {readOnly ? (
        <Text style={{ fontSize: 13 }}>{field.value || '—'}</Text>
      ) : (
        <Input size="small" value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} onPressEnter={save} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Notes card**

In `ShipmentDetailStageCards.tsx` import `DetailExtraFieldRows`, `ShipmentCustomFieldRows` and `DETAIL_EXTRA_FIELDS`; replace the Notes card body `<ShipmentFieldGroup {...groupProps} groupKey="notes" />` with:

```tsx
      <ShipmentFieldGroup {...groupProps} groupKey="notes" />
      <DetailExtraFieldRows {...groupProps} fields={DETAIL_EXTRA_FIELDS.notes} />
      <ShipmentCustomFieldRows shipment={shipment} readOnly={readOnly} />
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/ && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, tsc exit 0.

- [ ] **Step 7: Commit** (only if approved)

```bash
git status
git add frontend/src/hooks/useShipmentCustomField.ts frontend/src/components/shipment/ShipmentCustomFieldRows.tsx frontend/src/components/shipment/ShipmentCustomFieldRows.test.tsx frontend/src/components/shipment/ShipmentDetailStageCards.tsx
git diff --cached --stat
git commit -m "feat(frontend): Sheet notes and admin custom rows on the shipment page"
```

---

### Task 7: Documents print card — the whole packet on the shipment page

**Files:**
- Create: `frontend/src/components/shipment/ShipmentDocumentsPrintCard.tsx`
- Create: `frontend/src/components/shipment/ShipmentDocumentsPrintCard.test.tsx`
- Modify: `frontend/src/pages/export/ShipmentDetail.tsx` (render order, ~L106-116)

**Interfaces:**
- Consumes: `useShipmentDocumentPacket(shipmentId: number | null)` (`@/hooks/useDocumentPackets`, import only); `DocumentPacketPanel({ packet })` (`@/components/DocumentPacketPanel`, unchanged); `canDo` (`@/utils/permissions`); i18n `shipment_detail.parts.documents_title` / `documents_no_firm` (Task 2).
- Produces: `ShipmentDocumentsPrintCard({ shipmentId: number })`; element id `#section-documents-print`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/shipment/ShipmentDocumentsPrintCard.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { canDo } from '@/utils/permissions';
import { ShipmentDocumentsPrintCard } from './ShipmentDocumentsPrintCard';

vi.mock('@/hooks/useDocumentPackets', () => ({ useShipmentDocumentPacket: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock('@/utils/permissions', () => ({ canDo: vi.fn() }));
vi.mock('@/components/DocumentPacketPanel', () => ({
  DocumentPacketPanel: ({ packet }: { packet: { shipment_code: string } }) => <div>packet {packet.shipment_code}</div>,
}));
beforeAll(async () => { await i18n.changeLanguage('en'); });

function setup(allowed: boolean, packet: object | null) {
  vi.mocked(canDo).mockReturnValue(allowed);
  vi.mocked(useShipmentDocumentPacket).mockReturnValue({ data: packet, isLoading: false } as any);
  return render(<ShipmentDocumentsPrintCard shipmentId={9} />);
}

describe('ShipmentDocumentsPrintCard', () => {
  it('shows the truck packet (CMR, TIR, ZIP, per-firm invoices) in-page', () => {
    setup(true, { id: 9, shipment_code: '0101009/26' });
    expect(screen.getByText(i18n.t('shipment_detail.parts.documents_title'))).toBeInTheDocument();
    expect(screen.getByText('packet 0101009/26')).toBeInTheDocument();
  });

  it('explains the empty state before an export firm is chosen', () => {
    setup(true, null);
    expect(screen.getByText(i18n.t('shipment_detail.parts.documents_no_firm'))).toBeInTheDocument();
  });

  it('is hidden, and does not fetch, without the sale grant', () => {
    const { container } = setup(false, null);
    expect(container).toBeEmptyDOMElement();
    expect(useShipmentDocumentPacket).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/shipment/ShipmentDocumentsPrintCard.test.tsx`
Expected: FAIL — cannot resolve `./ShipmentDocumentsPrintCard`.

- [ ] **Step 3: Implement**

`frontend/src/components/shipment/ShipmentDocumentsPrintCard.tsx`:

```tsx
import { Card, Empty, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { DocumentPacketPanel } from '@/components/DocumentPacketPanel';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';

interface IShipmentDocumentsPrintCardProps {
  shipmentId: number;
}

/**
 * The truck's whole document packet — readiness banner, ZIP, CMR, TIR carnet
 * and each export firm's invoice / letters — viewed and printed from the
 * shipment page without opening Documents (spec 2026-09-30 §3a). Same panel
 * as a Documents-page row. The endpoint is gated by the 'sale' resource, so
 * the card is hidden (and nothing is fetched) for roles without it.
 */
export function ShipmentDocumentsPrintCard({ shipmentId }: IShipmentDocumentsPrintCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const allowed = canDo(user, 'sale', 'view');
  const { data: packet, isLoading } = useShipmentDocumentPacket(allowed ? shipmentId : null);
  if (!allowed) return null;

  return (
    <Card
      id="section-documents-print"
      size="small"
      style={{ marginBottom: 16 }}
      title={<span style={{ fontWeight: 600, fontSize: 13 }}>{t('shipment_detail.parts.documents_title')}</span>}
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '12px auto' }} />
      ) : packet ? (
        <DocumentPacketPanel packet={packet} />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('shipment_detail.parts.documents_no_firm')} />
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Place it**

In `pages/export/ShipmentDetail.tsx` import `ShipmentDocumentsPrintCard` and render it between `<ShipmentDetailStageCards … />` and `<ShipmentSaleSection … />`:

```tsx
      <ShipmentDocumentsPrintCard shipmentId={shipment.id} />
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/components/shipment/ src/pages/export/ && npx tsc --noEmit --ignoreDeprecations 5.0`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit** (only if approved)

```bash
git status
git add frontend/src/components/shipment/ShipmentDocumentsPrintCard.tsx frontend/src/components/shipment/ShipmentDocumentsPrintCard.test.tsx frontend/src/pages/export/ShipmentDetail.tsx
git diff --cached --stat
git commit -m "feat(frontend): print the whole document packet from the shipment page"
```

---

### Task 8: Acceptance — every task target is reachable; docs; full verification

**Files:**
- Create: `frontend/src/components/shipment/detailCoverage.test.tsx`
- Modify: `docs/obsidian/processes/detail-vs-sheet.md` (rewrite)
- Modify: `CHANGELOG.md`, `BUILD_TEST_LOG.md`

**Interfaces:**
- Consumes: everything above; `EDITABLE_FIELD_KEYS`, `sectionAnchorFor` (`ShipmentCompletenessBar.helpers`).

- [ ] **Step 1: Write the acceptance test**

`frontend/src/components/shipment/detailCoverage.test.tsx`:

```tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ShipmentDetailStageCards } from './ShipmentDetailStageCards';
import { ShipmentSaleSection } from './ShipmentSaleSection';
import { EDITABLE_FIELD_KEYS, sectionAnchorFor } from './ShipmentCompletenessBar.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({ default: { patch: vi.fn(), get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin', is_superuser: true } }) }));
vi.mock('@/components/shipment/tripAccess', () => ({ canManageTrips: () => true }));
vi.mock('@/components/shipment/ShipmentTripBanner', () => ({ ShipmentTripBanner: () => null }));
vi.mock('@/components/shipment/ShipmentFirmSelector', () => ({ ShipmentFirmSelector: () => null }));
vi.mock('@/components/shipment/VarietyOverrideRow', () => ({ VarietyOverrideRow: () => null }));
vi.mock('@/components/shipment/ShipmentPackingActions', () => ({ ShipmentPackingActions: () => null }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => null }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({ ShipmentFirmContractsPanel: () => null }));
vi.mock('@/pages/export/ShipmentDetailHelpers', async (orig) => ({
  ...(await orig<typeof import('@/pages/export/ShipmentDetailHelpers')>()),
  SalesReportForm: () => null,
}));

/**
 * Every TaskRule.target_fields key seeded by
 * backend/apps/export/management/commands/seed_task_rules.py (2026-09-30).
 * When a rule gains a target, add it here — the chip for it must lead somewhere.
 */
const TASK_TARGET_KEYS = [
  'country', 'customer', 'import_firm', 'city', 'firm_splits', 'block_sources', 'trip_id',
  'driver_name', 'driver_phone', 'truck_plate', 'border_point', 'documents_status',
  'packing_template', 'has_current_advance', 'customs_exit_at', 'loading_started_at',
  'variety', 'weight_net', 'loading_ended_at',
  'quality.azyk_maglumatnama', 'quality.suriji_gozukdiriji', 'quality.hil_sertifikaty', 'quality.kalibrowka_analiz',
  'transit_days', 'transport_temp_c', 'shelf_life_days', 'departed_at', 'border_crossed_at',
  'sales_report', 'dest_entry_at', 'customs_entry_at', 'has_peregruz', 'peregruz_date',
  'arrived_at', 'sale_started_at', 'sale_ended_at', 'sales_report.approved_at',
];
// shipment_code is excluded: system-filled, shown in the hero, nothing to jump to.

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderDetail(shipment: IShipmentDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ShipmentDetailStageCards shipment={shipment} isDesktop={false} missingKeys={new Set()} readOnly={false}
          onOpenComments={() => {}} commentCountsByField={{}} canOverrideVariety={false} />
        <ShipmentSaleSection shipment={shipment} missingKeys={new Set()} readOnly={false} canEditSalesReport={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Where the completeness chip for `key` leads, or null if nowhere. */
function target(key: string): HTMLElement | null {
  if (EDITABLE_FIELD_KEYS.has(key)) return document.getElementById(`detail-field-${key}`);
  const anchor = sectionAnchorFor(key);
  return anchor ? document.getElementById(anchor) : null;
}

describe('every task target field is reachable on the Detail page', () => {
  it.each([
    ['regular', { is_gapy_satys: false, status_code: 'draft', trip_id: null }, TASK_TARGET_KEYS],
    ['gapy', { is_gapy_satys: true, status_code: 'draft', trip_id: null }, TASK_TARGET_KEYS.filter((k) => k !== 'trip_id')],
  ])('%s shipment', (_name, over, keys) => {
    renderDetail({ ...MOCK_SHIPMENT_DETAIL, ...over } as IShipmentDetail);
    const unreachable = keys.filter((key) => target(key) === null);
    expect(unreachable).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd frontend && npx vitest run src/components/shipment/detailCoverage.test.tsx`
Expected: PASS. If a key is listed as unreachable, the gap is real: add its row / id / anchor in the owning Task's file (do not remove the key from the list). Sanity check once: temporarily comment out `trip_id` in `SECTION_ANCHOR_BY_KEY` → the regular case must fail listing `trip_id`; restore.

- [ ] **Step 3: Full verification**

Run each and record the result:
1. `cd frontend && npx tsc --noEmit --ignoreDeprecations 5.0` → exit 0
2. `cd frontend && npx vitest run src/components/shipment/ src/components/sheet/ src/components/ShipmentEditDrawer.test.tsx src/pages/export/` → all pass (note any pre-existing failures separately, with the file name, and confirm they fail on `git stash`-free `HEAD` too by reading their assertion — do not stash a shared tree)
3. `cd backend && ./venv/Scripts/python.exe manage.py test apps.export.tests_detail_sheet_parity apps.export.tests_completeness_api apps.export.tests_packing apps.transport --noinput --verbosity=1` → pass
4. Permission regression (memory "Sheet Permission Fix Verification"): `cd backend && ./venv/Scripts/python.exe manage.py test apps.export -k TestEveryRoleCanEditItsOwnSheetRow --noinput --verbosity=1` → pass (no permission code changed; this proves it).

- [ ] **Step 4: Docs**

Rewrite `docs/obsidian/processes/detail-vs-sheet.md` to the current state:
- URL `/shipments/:id`; the card list (Destination, Transport, Loading, Documents, Notes, Quality + Sale, Quota, Customs expenses, GPS);
- the three parts on Detail: transport = Planning trip choose/unlink (regular) or typed truck (gapy); packaging = join (hero) / unjoin / swap on the Loading card; export = firms + contracts panel (Destination), packing panel (Documents);
- gross / tare / pallets / boxes are entered only in the packing panel on Detail (Edit drawer and pallet manifest still write the shipment columns; the CMR prefers the template);
- the «Документы — печать» card: the Documents-page packet (ZIP, CMR, TIR, per-firm invoice/letters) printed in-page, visible with the `sale` grant;
- which Sheet rows are still Sheet-only (none of the task targets; list any display-only rows left);
- remove MyTaskCard / PhaseContextStrip / OtherTasksRow and "five collapsible sections".

Add one line to `CHANGELOG.md` under `[Unreleased]` → **Added**: `Shipment page shows every Sheet field; choose/unlink Planning trip, unjoin/swap packing, packing (gross/net), contracts and document-print panels in-page (feat p3/frontend)`.
Add on top of `BUILD_TEST_LOG.md`: `- [ ] 2026-09-30 — Shipment detail: Sheet parity + three parts (trip pick/unlink, unjoin/swap, packing + contracts panels, document packet print, notes/custom rows) — NEEDS TEST`.

- [ ] **Step 5: Commit** (only if approved)

```bash
git status
git add frontend/src/components/shipment/detailCoverage.test.tsx docs/obsidian/processes/detail-vs-sheet.md docs/superpowers/specs/2026-09-30-shipment-detail-full-design.md docs/superpowers/plans/2026-09-30-shipment-detail-full.md
git diff --cached --stat
git commit -m "test(frontend): every task target is reachable on the shipment page; docs"
```

CHANGELOG.md and BUILD_TEST_LOG.md are often dirty from other sessions — commit only your added line (private index) or leave them for the user.
