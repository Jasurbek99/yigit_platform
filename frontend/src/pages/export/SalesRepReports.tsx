import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Tabs, Empty, Alert } from 'antd';
import { IconFileText } from '@tabler/icons-react';
import { ProTable } from '@ant-design/pro-components';
import { useMySalesReports } from '@/hooks/useMySalesReports';
import { SalesReportDrawer } from '@/components/SalesReportDrawer';
import type { ISalesRepShipment } from '@/types';
import { COLORS } from '@/constants/styles';
import { buildSalesRepColumns } from './salesRepColumns';

// ─── Drawer state helper ──────────────────────────────────────────────────────

interface IDrawerState {
  readonly shipmentId: number | null;
  readonly shipmentCode: string;
}

const CLOSED_DRAWER: IDrawerState = { shipmentId: null, shipmentCode: '' };

// ─── Tab pane ────────────────────────────────────────────────────────────────

interface ITabPaneProps {
  readonly needsReport: boolean;
  readonly emptyText: string;
  readonly onOpenDrawer: (id: number, code: string) => void;
}

function ShipmentTab({ needsReport, emptyText, onOpenDrawer }: ITabPaneProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMySalesReports(needsReport);
  const rows = data?.results ?? [];

  const columns = buildSalesRepColumns({ t, showReportStatus: !needsReport, onOpenDrawer });

  if (isError) {
    return (
      <Alert
        type="error"
        message={t('sales_reports.error_load')}
        showIcon
        style={{ margin: 16 }}
      />
    );
  }

  return (
    <ProTable<ISalesRepShipment>
      rowKey="id"
      dataSource={rows}
      loading={isLoading}
      columns={columns}
      search={false}
      options={false}
      pagination={{ pageSize: 50, showSizeChanger: true }}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty description={emptyText} /> }}
      toolBarRender={false}
      size="small"
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesRepReports() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [drawer, setDrawer] = useState<IDrawerState>(CLOSED_DRAWER);

  function handleOpenDrawer(id: number, code: string) {
    setDrawer({ shipmentId: id, shipmentCode: code });
  }

  function handleCloseDrawer() {
    setDrawer(CLOSED_DRAWER);
  }

  function handleReportSaved() {
    void queryClient.invalidateQueries({ queryKey: ['shipments', 'my-sales-reports', true] });
    void queryClient.invalidateQueries({ queryKey: ['shipments', 'my-sales-reports', false] });
    handleCloseDrawer();
  }

  const tabs = [
    {
      key: 'needs',
      label: t('sales_reports.tab_needs_report'),
      children: (
        <ShipmentTab
          needsReport
          emptyText={t('sales_reports.empty')}
          onOpenDrawer={handleOpenDrawer}
        />
      ),
    },
    {
      key: 'all',
      label: t('sales_reports.tab_all'),
      children: (
        <ShipmentTab
          needsReport={false}
          emptyText={t('sales_reports.no_regions_hint')}
          onOpenDrawer={handleOpenDrawer}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: COLORS.textDark,
            lineHeight: '1.3',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconFileText style={{ color: COLORS.primary }} />
          {t('sales_reports.title')}
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
          {t('sales_reports.subtitle')}
        </div>
      </div>

      <Tabs defaultActiveKey="needs" items={tabs} />

      <SalesReportDrawer
        shipmentId={drawer.shipmentId}
        shipmentCode={drawer.shipmentCode}
        open={drawer.shipmentId !== null}
        onClose={handleCloseDrawer}
        onSaved={handleReportSaved}
      />
    </div>
  );
}

