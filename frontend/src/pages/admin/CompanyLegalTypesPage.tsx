import { useNavigate } from 'react-router-dom';
import { Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import CompanyLegalTypesTable from './CompanyLegalTypesTable';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

/**
 * The legal-form registry behind both firm screens (`/admin/legal-forms`).
 *
 * Reached by the gear button on the export and import firm lists rather than
 * from the sidebar — it is reference data for those two screens, not a
 * destination of its own. It has no page permission code for the same reason:
 * the route is gated on holding either firm page, so anyone who can open a firm
 * can open the forms behind it.
 */
export default function CompanyLegalTypesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // The list serves both registries, so either firm's edit right opens it.
  const canWrite =
    canDo(user, 'export_firm', 'edit') || canDo(user, 'import_firm', 'edit');

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space align="center" size={8} style={{ marginBottom: 4 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            size="small"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
          />
          <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined style={{ color: COLORS.primary }} />
            {t('company_legal_types.title')}
          </Title>
        </Space>
        <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
          {t('company_legal_types.subtitle')}
        </Text>
      </div>

      <CompanyLegalTypesTable canWrite={canWrite} />
    </div>
  );
}
