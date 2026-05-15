import { Form, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { FieldEditor } from '@/components/FieldEditor';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import type { IShipmentDetail } from '@/types';
import { fieldKeyToConfig, getFieldValue } from './TaskCardEditor.helpers';

const { Text } = Typography;

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
