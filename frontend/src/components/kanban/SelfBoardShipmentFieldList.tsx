import { Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { SheetCellEditor } from '@/components/sheet/SheetCellEditor';
import { getCellValue } from '@/components/sheet/getCellValue';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { fieldKeyToConfig } from '@/components/shipment/TaskCardEditor.helpers';
import { useShipmentOptions } from '@/hooks/useAdmin';
import { useSheetStore } from '@/stores/sheetStore';
import type { IRowConfig, ISheetRowSettingForUser, IShipmentDetail, IShipmentSheetItem } from '@/types';
import { COLORS, FONT } from '@/constants/styles';
import { PackingTemplateField } from './PackingTemplateField';

const { Text } = Typography;

/**
 * Task target fields with no Sheet row at all, edited on the card with the
 * Detail page's autosaving row instead. An explicit list, not "any field
 * without a row": `rows` also drops rows a user hid in their own Sheet, and
 * those must stay read-only stubs here. Shelf life is the quality inspector's
 * third reading (E2E 2026-10-01); transit days and temperature are NOT here —
 * see SHEET_ROW_FOR_TASK_FIELD (a Detail PATCH skips the sheet cache, so a
 * second editor beside the Sheet row would show stale values).
 */
const DETAIL_EDITED_TASK_FIELDS = new Set(['shelf_life_days']);

/**
 * Task target fields whose Sheet row has another key. R26 «Ýol gün we temp»
 * (`transit_days_temp`) edits both readings as `"5 4"`; their own rows were
 * removed 2026-06-06. The combined row renders once in the task list and is
 * left out of «Shipment fields» (2026-10-02).
 */
const SHEET_ROW_FOR_TASK_FIELD: Record<string, string> = {
  transit_days: 'transit_days_temp',
  transport_temp_c: 'transit_days_temp',
};

function sheetRowKeyFor(fieldKey: string): string {
  return SHEET_ROW_FOR_TASK_FIELD[fieldKey] ?? fieldKey;
}

interface ISelfBoardShipmentFieldListProps {
  shipmentId: number;
  /** Needed only for DETAIL_EDITED_TASK_FIELDS; without it they render as stubs. */
  shipment?: IShipmentDetail;
  sheetItem: IShipmentSheetItem | null;
  rows: IRowConfig[];
  rowSettings: Record<string, ISheetRowSettingForUser>;
  /**
   * Explicit ordered list of field_keys to render.
   * When provided, renders exactly these fields in this order (task-panel mode).
   * Missing rows (e.g. quality.* dotted fields) render as a read-only fallback stub.
   */
  fields?: string[];
  /**
   * Fields to exclude from the list (lower-section / "other fields" mode).
   * Only relevant when `fields` is NOT provided.
   */
  excludeFields?: string[];
  /** When true, show a skeleton while sheet data is loading. */
  isLoading?: boolean;
  /**
   * When true, all fields are rendered read-only regardless of can_current_user_edit.
   * Used when the task is done/cancelled.
   */
  disabled?: boolean;
}

/**
 * Unified vertical list of shipment fields for the task drawer.
 *
 * Two modes, selected by which prop is provided:
 *
 * **Task-panel mode** (`fields` prop) — iterate the given keys in order.
 * - Renders editable or read-only depending on `can_current_user_edit`.
 * - No row in `rows` → read-only fallback stub with "edit in shipment detail" hint.
 * - Does NOT filter by `input_type === 'readonly'` (target fields may be any type).
 *
 * **Other-fields mode** (`excludeFields` prop) — render all rows the user can
 * edit, skipping excluded keys and `readonly` input types.
 */
export function SelfBoardShipmentFieldList({
  shipmentId,
  shipment,
  sheetItem,
  rows,
  rowSettings,
  fields,
  excludeFields = [],
  isLoading = false,
  disabled = false,
}: ISelfBoardShipmentFieldListProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { editingCell, setEditingCell } = useSheetStore();

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }

  if (!sheetItem) return null;

  // ── Task-panel mode: iterate `fields` in order ──────────────────────────
  if (fields !== undefined) {
    if (fields.length === 0) {
      return (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('tasks.no_target_fields')}
        </Text>
      );
    }

    const renderedRowKeys = new Set<string>();

    return (
      <div>
        {fields.map((fieldKey) => {
          // «Brutto/netto»: the packing template has no Sheet row — pick it here.
          if (fieldKey === 'packing_template') {
            return <PackingTemplateField key={fieldKey} shipmentId={shipmentId} disabled={disabled} />;
          }
          const rowKey = sheetRowKeyFor(fieldKey);
          const row = rows.find((r) => r.field_key === rowKey);
          if (row != null) {
            if (renderedRowKeys.has(rowKey)) return null;
            renderedRowKeys.add(rowKey);
          }

          const detailConfig = DETAIL_EDITED_TASK_FIELDS.has(fieldKey) ? fieldKeyToConfig(fieldKey) : null;
          if (row == null && shipment && detailConfig) {
            return <DetailFieldRow key={fieldKey} shipment={shipment} config={detailConfig} readOnly={disabled} />;
          }

          // Dotted paths (quality.*) and truly unknown keys — read-only stub.
          if (row == null) {
            return (
              <ReadOnlyStubRow
                key={fieldKey}
                fieldKey={fieldKey}
                shipmentId={shipmentId}
                sheetItem={sheetItem}
              />
            );
          }

          const setting = rowSettings[rowKey];
          const canEdit = !disabled && setting?.can_current_user_edit === true;

          return (
            <FieldRow
              key={rowKey}
              row={row}
              sheetItem={sheetItem}
              shipmentId={shipmentId}
              canEdit={canEdit}
              isEditing={
                !disabled &&
                editingCell?.shipmentId === shipmentId &&
                editingCell.rowKey === rowKey
              }
              onEdit={() => setEditingCell({ shipmentId, rowKey })}
            />
          );
        })}
      </div>
    );
  }

  // ── Other-fields mode: all editable rows minus excluded ─────────────────
  const excludeSet = new Set([...excludeFields, ...excludeFields.map(sheetRowKeyFor)]);

  const editableRows = rows.filter((row) => {
    if (excludeSet.has(row.field_key)) return false;
    if (row.input_type === 'readonly') return false;
    const setting = rowSettings[row.field_key];
    return setting?.can_current_user_edit === true;
  });

  if (editableRows.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('me.board.drawer_no_editable_fields')}
      </Text>
    );
  }

  // Filled fields first, then the empty ones; Sheet order within each group.
  // getCellValue renders an empty cell as '—' (or '' in a few branches).
  const isFilled = (row: IRowConfig) => !['', '—'].includes(getCellValue(sheetItem, row).trim());
  const orderedRows = [...editableRows.filter(isFilled), ...editableRows.filter((row) => !isFilled(row))];

  return (
    <div>
      {orderedRows.map((row) => (
        <FieldRow
          key={row.field_key}
          row={row}
          sheetItem={sheetItem}
          shipmentId={shipmentId}
          canEdit
          isEditing={
            editingCell?.shipmentId === shipmentId &&
            editingCell.rowKey === row.field_key
          }
          onEdit={() => setEditingCell({ shipmentId, rowKey: row.field_key })}
        />
      ))}
    </div>
  );
}

// ─── Shared row component ─────────────────────────────────────────────────────

interface IFieldRowProps {
  row: IRowConfig;
  sheetItem: IShipmentSheetItem;
  shipmentId: number;
  canEdit: boolean;
  isEditing: boolean;
  onEdit: () => void;
}

function FieldRow({
  row,
  sheetItem,
  shipmentId: _shipmentId,
  canEdit,
  isEditing,
  onEdit,
}: IFieldRowProps): React.ReactElement {
  const { t } = useTranslation();
  // Status codes (harvest_status, documents_status) → their label, as on the Sheet.
  const { data: options } = useShipmentOptions();
  const displayValue = getCellValue(sheetItem, row, options);
  const isNumericType = row.input_type === 'number';

  const clickable = canEdit && !isEditing;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 0',
        borderBottom: `1px solid ${COLORS.border}`,
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={clickable ? onEdit : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEdit();
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? t(row.label_key) : undefined}
    >
      {/* Label */}
      <Text
        style={{
          fontSize: 12,
          color: COLORS.textSecondary,
          minWidth: 140,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {t(row.label_key)}
      </Text>

      {/* Value or editor */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isEditing ? (
          // SheetCellEditor reads/writes global editingCell and calls
          // setEditingCell(null) on save/blur — no extra teardown needed.
          <SheetCellEditor shipment={sheetItem} rowConfig={row} />
        ) : (
          <Text
            style={{
              fontSize: 13,
              fontFamily: isNumericType ? FONT.mono : undefined,
              color: displayValue === '—' ? COLORS.textMuted : COLORS.textPrimary,
            }}
          >
            {displayValue}
          </Text>
        )}
      </div>
    </div>
  );
}

// ─── Read-only fallback for dotted / unmapped field_keys ─────────────────────

interface IReadOnlyStubRowProps {
  fieldKey: string;
  shipmentId: number;
  sheetItem: IShipmentSheetItem;
}

/**
 * Renders a read-only row for a field_key that has no matching IRowConfig.
 * This covers quality.* dotted-path fields used by the quality_inspection task.
 *
 * Label: resolves via `tasks.field_label.<fieldKey>` (already seeded for quality.*).
 * Value: reads the nested path from sheetItem if possible, else shows "—".
 * Edit hint: a link to this field on the shipment page (2026-10-02).
 */
function ReadOnlyStubRow({
  fieldKey,
  shipmentId,
  sheetItem,
}: IReadOnlyStubRowProps): React.ReactElement {
  const { t } = useTranslation();

  const label = t(`tasks.field_label.${fieldKey}`, { defaultValue: fieldKey });

  // Resolve dotted paths (e.g. "quality.azyk_maglumatnama")
  const rawValue = resolveNestedValue(sheetItem as unknown as Record<string, unknown>, fieldKey);
  let displayValue = '—';
  if (rawValue === true) displayValue = '✓';
  else if (rawValue === false) displayValue = '—';
  else if (rawValue != null) displayValue = String(rawValue);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 0',
        borderBottom: `1px solid ${COLORS.border}`,
        cursor: 'default',
      }}
    >
      {/* Label */}
      <Text
        style={{
          fontSize: 12,
          color: COLORS.textSecondary,
          minWidth: 140,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {label}
      </Text>

      {/* Value + hint */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontSize: 13,
            color: displayValue === '—' ? COLORS.textMuted : COLORS.textPrimary,
          }}
        >
          {displayValue}
        </Text>
        {/* Straight to this field — ShipmentDetail scrolls to the hash once loaded. */}
        <Link
          to={`/shipments/${shipmentId}#detail-field-${fieldKey}`}
          style={{ fontSize: 11, display: 'block', marginTop: 2 }}
        >
          {t('tasks.edit_in_detail')}
        </Link>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}
