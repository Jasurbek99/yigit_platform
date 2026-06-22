import { Drawer, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useAuth } from '@/hooks/useAuth';
import { SalesReportPanel } from '@/components/SalesReportPanel';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';

const { Text } = Typography;

interface IOverdueReportDrawerProps {
  readonly shipmentId: number | null;
  readonly shipmentCode: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function OverdueReportDrawer({
  shipmentId,
  shipmentCode,
  open,
  onClose,
  onSaved,
}: IOverdueReportDrawerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const idStr = shipmentId != null ? String(shipmentId) : undefined;

  const { data: detail, isLoading, isError } = useShipmentDetail(
    open ? idStr : undefined,
  );

  const canEdit =
    (
      user?.role === 'sales_rep' ||
      user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.is_superuser === true
    ) && (detail?.status_step ?? 0) >= MIN_SALES_REPORT_STEP;

  return (
    <Drawer
      title={`${t('overdue.drawer_title')} — ${shipmentCode}`}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin />
        </div>
      )}

      {isError && (
        <Text type="danger">{t('shipment_detail.error_load')}</Text>
      )}

      {!isLoading && !isError && detail != null && (
        <SalesReportPanel
          key={idStr}
          shipmentId={idStr!}
          report={detail.sales_report}
          canEdit={canEdit}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}
