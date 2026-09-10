import { Alert, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/** `firms_admin` for export firms, `import_firms_admin` for import firms. */
type LabelNamespace = 'firms_admin' | 'import_firms_admin';

interface IFirmCompletenessProps {
  /** Field keys still empty — from `missingExportFirmFields` / `missingImportFirmFields`. */
  missing: readonly string[];
  labelNamespace: LabelNamespace;
}

/**
 * Green when a firm has every field its generated documents need, amber with
 * the count when it does not. Hover **or tap** the amber tag to see which
 * fields are missing — Ant Design's default tooltip trigger is hover-only,
 * which leaves touch users with no way to read it.
 */
export function FirmCompletenessTag({ missing, labelNamespace }: IFirmCompletenessProps) {
  const { t } = useTranslation();

  if (missing.length === 0) {
    return (
      <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
        {t('firm_completeness.complete')}
      </Tag>
    );
  }

  const tooltip = (
    <div>
      <div style={{ marginBottom: 4 }}>{t('firm_completeness.tooltip_title')}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {missing.map((key) => (
          <li key={key}>{t(`${labelNamespace}.${key}`, { defaultValue: key })}</li>
        ))}
      </ul>
    </div>
  );

  return (
    // The firm rows navigate on click; swallow the event so opening the
    // tooltip does not also open the detail page.
    <span onClick={(e) => e.stopPropagation()}>
      <Tooltip title={tooltip} trigger={['hover', 'click']}>
        <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0, cursor: 'pointer' }}>
          {t('firm_completeness.missing_count', { count: missing.length })}
        </Tag>
      </Tooltip>
    </span>
  );
}

/** Full-width banner for the firm detail pages — same rules, more room. */
export function FirmCompletenessAlert({ missing, labelNamespace }: IFirmCompletenessProps) {
  const { t } = useTranslation();

  if (missing.length === 0) {
    return (
      <Alert
        type="success"
        showIcon
        message={t('firm_completeness.alert_complete')}
        style={{ marginBottom: 16 }}
      />
    );
  }

  return (
    <Alert
      type="warning"
      showIcon
      message={t('firm_completeness.alert_missing', { count: missing.length })}
      description={
        <Space size={[6, 6]} wrap style={{ marginTop: 4 }}>
          {missing.map((key) => (
            <Tag key={key} color="warning" style={{ margin: 0 }}>
              {t(`${labelNamespace}.${key}`, { defaultValue: key })}
            </Tag>
          ))}
          <Text type="secondary" style={{ fontSize: 12, width: '100%' }}>
            {t('firm_completeness.alert_hint')}
          </Text>
        </Space>
      }
      style={{ marginBottom: 16 }}
    />
  );
}
