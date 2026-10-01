import { useEffect, useRef, useState } from 'react';
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

interface ICustomFieldRowProps {
  shipmentId: number;
  field: IShipmentCustomField;
  label: string;
  readOnly: boolean;
}

function CustomFieldRow({ shipmentId, field, label, readOnly }: ICustomFieldRowProps) {
  const { t } = useTranslation();
  const patch = usePatchCustomField(shipmentId);
  const persisted = field.value ?? '';
  const [value, setValue] = useState(persisted);
  const syncedRef = useRef(persisted);
  const sentRef = useRef<string | null>(null);

  // A newer value from the server (Sheet edit, another tab) replaces the
  // input unless the user is mid-edit — else a tab-through would write the
  // old value back.
  useEffect(() => {
    setValue((current) => (current === syncedRef.current ? persisted : current));
    syncedRef.current = persisted;
    sentRef.current = null;
  }, [persisted]);

  // Each PATCH writes an audit row — save only a real change, once.
  function save() {
    if (value === persisted || value === sentRef.current) return;
    sentRef.current = value;
    patch.mutate({ fieldKey: field.field_key, value }, {
      onError: () => { sentRef.current = null; toast.error(t('common.error')); },
    });
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
