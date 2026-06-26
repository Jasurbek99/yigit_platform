import { Button } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import type { TFunction } from 'i18next';
import { StatusTag } from '@/components/StatusTag';
import type { ISalesRepShipment } from '@/types';
import { COLORS } from '@/constants/styles';

interface IBuildColumnsOptions {
  readonly t: TFunction;
  readonly showReportStatus: boolean;
  readonly onOpenDrawer: (id: number, code: string) => void;
}

export function buildSalesRepColumns({
  t,
  showReportStatus,
  onOpenDrawer,
}: IBuildColumnsOptions): ProColumns<ISalesRepShipment>[] {
  const base: ProColumns<ISalesRepShipment>[] = [
    {
      title: t('sales_reports.col_shipment_code'),
      dataIndex: 'shipment_code',
      width: 140,
      search: false,
      sorter: (a, b) => (a.shipment_code ?? '').localeCompare(b.shipment_code ?? ''),
    },
    {
      title: t('sales_reports.col_status'),
      dataIndex: 'status_display',
      width: 140,
      search: false,
      sorter: (a, b) => a.status_display.localeCompare(b.status_display),
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('sales_reports.col_country'),
      dataIndex: 'country_name',
      width: 130,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.country_name ?? '').localeCompare(b.country_name ?? ''),
      render: (_, record) => record.country_name ?? '—',
    },
    {
      title: t('sales_reports.col_city'),
      dataIndex: 'city_name',
      width: 130,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.city_name ?? '').localeCompare(b.city_name ?? ''),
      render: (_, record) => record.city_name ?? '—',
    },
    {
      title: t('sales_reports.col_customer'),
      dataIndex: 'customer_name',
      width: 160,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''),
      render: (_, record) => record.customer_name ?? '—',
    },
    {
      title: t('sales_reports.col_weight_net'),
      dataIndex: 'weight_net',
      width: 110,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.weight_net ?? 0) - (b.weight_net ?? 0),
      render: (_, record) =>
        record.weight_net != null ? record.weight_net.toLocaleString() : '—',
    },
  ];

  if (showReportStatus) {
    base.push({
      title: t('sales_reports.col_report_status'),
      dataIndex: 'has_sales_report',
      width: 100,
      search: false,
      sorter: (a, b) => Number(a.has_sales_report) - Number(b.has_sales_report),
      render: (_, record) =>
        record.has_sales_report ? (
          <span style={{ color: COLORS.success, fontWeight: 600 }}>
            {t('sales_reports.report_filled')}
          </span>
        ) : (
          <span style={{ color: COLORS.danger, fontWeight: 600 }}>
            {t('sales_reports.report_missing')}
          </span>
        ),
    });
  }

  base.push({
    key: 'action',
    width: 130,
    search: false,
    render: (_, record) => (
      <Button
        size="small"
        type="primary"
        ghost
        onClick={(e) => {
          e.stopPropagation();
          onOpenDrawer(record.id, record.shipment_code);
        }}
      >
        {t('sales_reports.open_report')}
      </Button>
    ),
  });

  return base;
}
