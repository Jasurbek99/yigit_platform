import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Flex, Skeleton, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useAuth } from '@/hooks/useAuth';
import { PalletManifestPanel } from './pallet/PalletManifestPanel';
import { FONT } from '@/constants/styles';

const { Title } = Typography;

export default function PalletManifest() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const shipmentId = id ? parseInt(id, 10) : null;

  const { data: shipment, isLoading: shipmentLoading } = useShipmentDetail(id);
  useAuth(); // ensures auth guard is active

  if (shipmentLoading) {
    return <div style={{ padding: 24 }}><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }

  if (!shipment || shipmentId == null) {
    return <Alert type="error" message={t('pallet.title')} style={{ margin: 24 }} />;
  }

  return (
    <div style={{ padding: 24 }}>
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} aria-label={t('common.back')} />
        <Title level={4} style={{ margin: 0 }}>
          {t('pallet.title')} — <span style={{ fontFamily: FONT.mono }}>{shipment.shipment_code}</span>
        </Title>
      </Flex>

      <PalletManifestPanel shipmentId={shipmentId} />
    </div>
  );
}
