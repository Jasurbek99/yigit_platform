import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Tabs, Empty, Alert } from 'antd';
import { IconFileText } from '@tabler/icons-react';
import { ProTable } from '@ant-design/pro-components';
import { useMySalesReports } from '@/hooks/useMySalesReports';
import type { ISalesRepShipment } from '@/types';
import { COLORS } from '@/constants/styles';
import { buildSalesRepColumns } from './salesRepColumns';

// ─── Tab pane ────────────────────────────────────────────────────────────────

interface ITabPaneProps {
  readonly needsReport: boolean;
  readonly emptyText: string;
  readonly onOpenReport: (id: number, code: string) => void;
}

function ShipmentTab({ needsReport, emptyText, onOpenReport }: ITabPaneProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMySalesReports(needsReport);
  const rows = data?.results ?? [];

  const columns = buildSalesRepColumns({
    t,
    showReportStatus: !needsReport,
    onOpenDrawer: onOpenReport,
  });

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
  const navigate = useNavigate();

  function handleOpenReport(id: number, _code: string) {
    navigate(`/export/sales-reports/${id}`);
  }

  const tabs = [
    {
      key: 'needs',
      label: t('sales_reports.tab_needs_report'),
      children: (
        <ShipmentTab
          needsReport
          emptyText={t('sales_reports.empty')}
          onOpenReport={handleOpenReport}
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
          onOpenReport={handleOpenReport}
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
    </div>
  );
}
