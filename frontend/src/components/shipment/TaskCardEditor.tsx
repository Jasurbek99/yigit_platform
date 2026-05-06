import { Form, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { FieldEditor } from '@/components/FieldEditor';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import type { IShipmentDetail } from '@/types';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';

const { Text } = Typography;

/**
 * Maps a task target_field_key to an IEditFieldConfig descriptor.
 * Only covers the fields that appear in the B7 seed rule set.
 * quality.* fields are read-only in this UI (checkboxes handled separately).
 */
function fieldKeyToConfig(fieldKey: string): IEditFieldConfig | null {
  // Dotted paths (quality.*, etc.) are display-only for now
  if (fieldKey.includes('.')) return null;

  const FIELD_MAP: Record<string, IEditFieldConfig> = {
    country: { key: 'country', labelKey: 'shipment_edit_drawer.field.country', inputType: 'select', optionsSource: 'countries' },
    customer: { key: 'customer', labelKey: 'shipment_edit_drawer.field.customer', inputType: 'select', optionsSource: 'customers' },
    import_firm: { key: 'import_firm', labelKey: 'shipment_edit_drawer.field.import_firm', inputType: 'select', optionsSource: 'importFirms' },
    city: { key: 'city', labelKey: 'shipment_edit_drawer.field.city', inputType: 'select', optionsSource: 'cities', countryFiltered: true },
    border_point: { key: 'border_point', labelKey: 'shipment_edit_drawer.field.border_point', inputType: 'select', optionsSource: 'borderPoints' },
    driver_id: { key: 'driver_id', labelKey: 'shipment_edit_drawer.field.driver', inputType: 'select', optionsSource: 'transportUsers' },
    weight_net: { key: 'weight_net', labelKey: 'shipment_edit_drawer.field.weight_net', inputType: 'number', min: 0, suffix: 'kg' },
    weight_gross: { key: 'weight_gross', labelKey: 'shipment_edit_drawer.field.weight_gross', inputType: 'number', min: 0, suffix: 'kg' },
    variety: { key: 'variety', labelKey: 'shipment_edit_drawer.field.variety', inputType: 'select', optionsSource: 'varieties' },
    cargo_code: { key: 'cargo_code', labelKey: 'shipment_edit_drawer.field.cargo_code', inputType: 'text' },
    documents_status: { key: 'documents_status', labelKey: 'shipment_edit_drawer.field.documents_status', inputType: 'option_select', optionsSource: 'documentsStatus' },
    customs_clearance_planned_day: { key: 'customs_clearance_planned_day', labelKey: 'shipment_edit_drawer.field.customs_clearance_planned_day', inputType: 'select', optionsSource: 'weekdays' },
  };

  return FIELD_MAP[fieldKey] ?? null;
}

/**
 * Reads the current value of a field from the shipment, including nested
 * paths (e.g. "quality.azyk_maglumatnama").
 */
function getFieldValue(shipment: IShipmentDetail, fieldKey: string): unknown {
  if (!fieldKey.includes('.')) {
    return (shipment as unknown as Record<string, unknown>)[fieldKey] ?? null;
  }
  const [top, sub] = fieldKey.split('.', 2);
  const parent = (shipment as unknown as Record<string, unknown>)[top];
  if (parent != null && typeof parent === 'object') {
    return (parent as Record<string, unknown>)[sub] ?? null;
  }
  return null;
}

/**
 * Returns true if a field can be considered "filled".
 * For junction tables (firm_splits, block_sources) checks array length.
 * For nested paths checks non-null value.
 * For scalars checks non-null/non-empty.
 */
export function isFieldFilled(shipment: IShipmentDetail, fieldKey: string): boolean {
  if (fieldKey === 'firm_splits') return shipment.firm_splits.length > 0;
  if (fieldKey === 'block_sources') return shipment.block_sources.length > 0;
  const value = getFieldValue(shipment, fieldKey);
  if (value == null) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  return false;
}

interface ITaskCardEditorProps {
  shipment: IShipmentDetail;
  targetFields: string[];
  disabled?: boolean;
}

/**
 * Renders a list of task target fields as editable form rows.
 * Uses FieldEditor (same as ShipmentEditDrawer) for each patchable field.
 * Dotted paths (quality.*) are shown read-only.
 * Junction-table fields (firm_splits, block_sources) are shown read-only with a note.
 */
export function TaskCardEditor({ shipment, targetFields, disabled = false }: ITaskCardEditorProps) {
  const { t } = useTranslation();
  const patch = useShipmentPatchMulti();

  const countryId = (shipment as unknown as Record<string, unknown>).country as number | null;

  function handleChange(fieldKey: string, value: unknown) {
    patch.mutate({ id: shipment.id, fields: { [fieldKey]: value } });
  }

  if (targetFields.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('tasks.no_target_fields')}
      </Text>
    );
  }

  return (
    <Form layout="vertical" style={{ marginBottom: 0 }}>
      {targetFields.map((fieldKey) => {
        const config = fieldKeyToConfig(fieldKey);
        const value = getFieldValue(shipment, fieldKey);

        if (config == null) {
          // Read-only display for dotted paths and junction-table fields
          const displayValue = fieldKey === 'firm_splits'
            ? shipment.firm_splits.map((s) => s.export_firm_name ?? '—').join(', ') || '—'
            : fieldKey === 'block_sources'
              ? shipment.block_sources.map((b) => b.block_code).join(', ') || '—'
              : String(value ?? '—');

          return (
            <Form.Item
              key={fieldKey}
              label={t(`tasks.field_label.${fieldKey}`, { defaultValue: fieldKey })}
              style={{ marginBottom: 10 }}
            >
              <Text style={{ fontSize: 13 }}>{displayValue}</Text>
            </Form.Item>
          );
        }

        return (
          <Form.Item
            key={fieldKey}
            label={t(config.labelKey)}
            style={{ marginBottom: 10 }}
          >
            <FieldEditor
              config={config}
              value={value}
              onChange={(v) => handleChange(fieldKey, v)}
              countryId={countryId}
              disabled={disabled || patch.isPending}
            />
          </Form.Item>
        );
      })}
    </Form>
  );
}
