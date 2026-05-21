import {
  Collapse,
  Descriptions,
  Divider,
  Space,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import dayjs from 'dayjs';
import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IEditFieldConfig, IEditFieldGroup } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail, ITaskListItem } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IOtherShipmentDetailsProps {
  task: ITaskListItem;
  shipment: IShipmentDetail;
}

export function OtherShipmentDetails({
  task,
  shipment,
}: IOtherShipmentDetailsProps): React.ReactElement | null {
  const { t } = useTranslation();

  const taskFieldSet = new Set(task.target_fields_list);

  const groupSections = EDIT_FIELD_GROUPS.map((group) => {
    const items = group.fields
      .filter((field) => !taskFieldSet.has(field.key))
      .map((field) => {
        const value = formatShipmentFieldValue(field, shipment, t);
        return value == null ? null : { field, value };
      })
      .filter((x): x is { field: IEditFieldConfig; value: string } => x != null);
    return items.length > 0 ? { group, items } : null;
  }).filter(
    (x): x is { group: IEditFieldGroup; items: { field: IEditFieldConfig; value: string }[] } =>
      x != null,
  );

  if (groupSections.length === 0) {
    return null;
  }

  return (
    <>
      <Divider style={{ margin: '8px 0 12px' }} />
      <Collapse
        size="small"
        items={[
          {
            key: 'other-details',
            label: t('me.board.drawer_more_details'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {groupSections.map(({ group, items }) => (
                  <Descriptions
                    key={group.key}
                    column={1}
                    size="small"
                    title={
                      <Text
                        style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}
                      >
                        {t(group.titleKey)}
                      </Text>
                    }
                    labelStyle={{ width: 140, color: COLORS.textSecondary }}
                  >
                    {items.map(({ field, value }) => (
                      <Descriptions.Item key={field.key} label={t(field.labelKey)}>
                        {value}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}

/**
 * Read-only display value for a shipment field. Returns null when the field
 * is null / empty so the caller can drop the row.
 */
function formatShipmentFieldValue(
  field: IEditFieldConfig,
  shipment: IShipmentDetail,
  t: TFunction,
): string | null {
  // IShipmentDetail is a structured interface; field.key is a plain string
  // from EDIT_FIELD_GROUPS[].fields[].key. TypeScript cannot narrow dynamic
  // key access without a discriminated union over every field, so the cast
  // to Record<string, unknown> is unavoidable here.
  const record = shipment as unknown as Record<string, unknown>;
  const raw = record[field.key];
  if (raw === null || raw === undefined || raw === '') return null;

  const NAME_PARTNER: Record<string, string> = {
    country: 'country_name',
    customer: 'customer_name',
    city: 'city_name',
    import_firm: 'import_firm_name',
    border_point: 'border_point_name',
    variety: 'variety_name',
    vehicle_responsible: 'vehicle_responsible_display',
  };
  const partnerKey = NAME_PARTNER[field.key];
  if (partnerKey) {
    const partner = record[partnerKey];
    if (typeof partner === 'string' && partner.trim()) return partner;
    return null;
  }

  if (field.inputType === 'boolean') {
    return raw ? t('common.yes') : t('common.no');
  }

  if (field.inputType === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) return null;
    const formatted = n.toLocaleString();
    return field.suffix ? `${formatted} ${field.suffix}` : formatted;
  }

  if (field.inputType === 'date') {
    // Guard: dayjs accepts many types but we expect ISO strings from the API.
    if (typeof raw !== 'string') return null;
    return dayjs(raw).format('DD MMM YYYY');
  }

  if (field.inputType === 'datetime') {
    // Guard: same reason — only parse when raw is a string.
    if (typeof raw !== 'string') return null;
    return dayjs(raw).format('DD MMM YYYY HH:mm');
  }

  if (field.optionsSource === 'weekdays') {
    return t(`weekday.${String(raw)}`);
  }

  return String(raw);
}
