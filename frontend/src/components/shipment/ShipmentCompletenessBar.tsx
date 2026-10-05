import { Card, Progress, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ICompleteness } from '@/types';
import { COLORS } from '@/constants/styles';
import { classifyMissingFields, missingFieldLabel, sectionAnchorFor } from './ShipmentCompletenessBar.helpers';
import { jumpToSection } from '@/pages/export/ShipmentDetailHelpers.helpers';

const { Text } = Typography;

interface IShipmentCompletenessBarProps {
  completeness: ICompleteness;
  onJumpToField: (fieldKey: string) => void;
}

/**
 * "What is still owed on this shipment" — driven entirely by the backend
 * completeness block (TaskRule-derived). Two parts, because rules with no
 * target_fields have nothing to highlight and would otherwise vanish:
 *   - chips  → fields that should be filled by now but are empty
 *   - checks → open tasks that are marked done by hand
 *
 * Field labels resolve via `missingFieldLabel` — the Edit-drawer label,
 * then the task field label, then a dotted key (`quality.*`) as its own
 * i18n path — so no raw key leaks onto the page.
 */
export function ShipmentCompletenessBar({
  completeness,
  onJumpToField,
}: IShipmentCompletenessBarProps) {
  const { t } = useTranslation();
  const { required_total, filled_count, missing_fields, manual_tasks } = completeness;

  // required_total is cumulative across every step the shipment has passed
  // (see backend/apps/export/services/completeness.py) and never returns to
  // zero once a shipment has advanced — it is NOT "nothing is owed right
  // now". Gate on what is actually outstanding instead: no missing fields
  // and no open manual tasks means nothing left to show, full stop.
  if (missing_fields.length === 0 && manual_tasks.length === 0) return null;

  // Two-tier split (Task 13): some missing keys (AD-1 timestamps,
  // firm_splits, block_sources, sales_report, shipment_code) have no
  // `#detail-field-<key>` row on the Detail page — their chip used to jump
  // nowhere. filled_count/required_total below still count everything
  // owed; only the chip rendering is split.
  const { actionable, informational } = classifyMissingFields(missing_fields);

  const percent = required_total === 0
    ? 100
    : Math.round((filled_count / required_total) * 100);

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text strong style={{ fontSize: 13 }}>
          {t('shipment.detail.completeness', { filled: filled_count, total: required_total })}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{percent}%</Text>
      </div>

      <Progress
        percent={percent}
        showInfo={false}
        size="small"
        strokeColor={percent === 100 ? COLORS.success : COLORS.warning}
        style={{ margin: '6px 0 8px' }}
      />

      {actionable.length > 0 && (
        <div style={{ marginBottom: informational.length > 0 || manual_tasks.length > 0 ? 10 : 0 }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>
            {t('shipment.detail.missing_label')}
          </Text>
          {actionable.map((field) => (
            <Tag
              key={field.key}
              color="warning"
              style={{ cursor: 'pointer', marginBottom: 4 }}
              onClick={() => onJumpToField(field.key)}
            >
              {missingFieldLabel(field.key, t)}
            </Tag>
          ))}
        </div>
      )}

      {informational.length > 0 && (
        <div style={{ marginBottom: manual_tasks.length > 0 ? 10 : 0 }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>
            {t('shipment.detail.info_fields_label')}
          </Text>
          {informational.map((field) => {
            const sectionId = sectionAnchorFor(field.key);
            const label = missingFieldLabel(field.key, t);
            const chip = (
              <Tag
                color="default"
                style={{
                  marginBottom: 4,
                  cursor: sectionId ? 'pointer' : 'default',
                  color: COLORS.textTertiary,
                }}
                onClick={sectionId ? () => jumpToSection(sectionId) : undefined}
              >
                {label}
              </Tag>
            );
            return sectionId ? (
              <span key={field.key}>{chip}</span>
            ) : (
              <Tooltip key={field.key} title={t('shipment.detail.info_field_hint')}>
                {chip}
              </Tooltip>
            );
          })}
        </div>
      )}

      {manual_tasks.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('shipment.detail.manual_tasks_label')}
          </Text>
          {manual_tasks.map((task) => (
            <div key={task.id} style={{ fontSize: 12, padding: '3px 0' }}>
              ☐ {t(task.title_key, { defaultValue: task.title_key })}
              <Tag style={{ marginLeft: 6, fontSize: 10 }}>
                {t(`tasks.role.${task.role}`, { defaultValue: task.role })}
              </Tag>
              {task.is_overdue && (
                <Text type="danger" style={{ fontSize: 11 }}>
                  {t('shipment.detail.overdue')}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
