import { Table } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IQuotaDashboardFirm } from '@/types';

interface IProps {
  data: IQuotaDashboardFirm[];
  expiredPerFirm?: Record<number, number>;
}

function fmtKg(val: number): string {
  return Number(val).toLocaleString();
}

function fmtPct(val: number): string {
  return `${Number(val).toFixed(1)}%`;
}

function buildTotals(data: IQuotaDashboardFirm[]): IQuotaDashboardFirm {
  return {
    export_firm: -1,
    export_firm_name: '',
    sales_kg: data.reduce((s, r) => s + r.sales_kg, 0),
    expected_kg: data.reduce((s, r) => s + r.expected_kg, 0),
    issued_kg: data.reduce((s, r) => s + r.issued_kg, 0),
    used_kg: data.reduce((s, r) => s + r.used_kg, 0),
    not_given_kg: data.reduce((s, r) => s + r.not_given_kg, 0),
    not_given_pct: 0,
    unused_kg: data.reduce((s, r) => s + r.unused_kg, 0),
    is_blocked: false,
  };
}

export function QuotaPerFirmTable({ data, expiredPerFirm = {} }: IProps) {
  const { t } = useTranslation();

  const sorted = [...data].sort((a, b) => b.not_given_kg - a.not_given_kg);
  const totals = buildTotals(data);

  const columns = [
    {
      title: t('quota_dashboard.firm'),
      dataIndex: 'export_firm_name',
      key: 'firm',
      render: (_: string, row: IQuotaDashboardFirm) => (
        <span style={{ color: row.is_blocked ? '#ff4d4f' : undefined, fontWeight: 500 }}>
          {row.export_firm_name}
        </span>
      ),
    },
    {
      title: t('quota_dashboard.sales'),
      dataIndex: 'sales_kg',
      key: 'sales_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.sales_kg - b.sales_kg,
    },
    {
      title: t('quota_dashboard.expected'),
      dataIndex: 'expected_kg',
      key: 'expected_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.expected_kg - b.expected_kg,
    },
    {
      title: t('quota_dashboard.issued'),
      dataIndex: 'issued_kg',
      key: 'issued_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.issued_kg - b.issued_kg,
    },
    {
      title: t('quota_dashboard.used'),
      dataIndex: 'used_kg',
      key: 'used_kg',
      align: 'right' as const,
      render: (v: number) => fmtKg(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.used_kg - b.used_kg,
    },
    {
      title: t('quota_dashboard.not_given'),
      dataIndex: 'not_given_kg',
      key: 'not_given_kg',
      align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#ff4d4f' : undefined, fontWeight: v > 0 ? 600 : undefined }}>
          {fmtKg(v)}
        </span>
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.not_given_kg - b.not_given_kg,
    },
    {
      title: t('quota_dashboard.not_given_pct'),
      dataIndex: 'not_given_pct',
      key: 'not_given_pct',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 30 ? '#ff4d4f' : v > 15 ? '#fa8c16' : undefined }}>
          {fmtPct(v)}
        </span>
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.not_given_pct - b.not_given_pct,
    },
    {
      title: t('quota_dashboard.unused'),
      dataIndex: 'unused_kg',
      key: 'unused_kg',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#fa8c16' : undefined }}>{fmtKg(v)}</span>
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.unused_kg - b.unused_kg,
    },
    {
      title: t('quota_dashboard.expired_unused'),
      key: 'expired_unused',
      align: 'right' as const,
      render: (_: unknown, row: IQuotaDashboardFirm) => {
        const v = expiredPerFirm[row.export_firm] ?? 0;
        return <span style={{ color: v > 0 ? '#ff4d4f' : undefined }}>{fmtKg(v)}</span>;
      },
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) =>
        (expiredPerFirm[a.export_firm] ?? 0) - (expiredPerFirm[b.export_firm] ?? 0),
    },
  ];

  const summaryRow = (
    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
      <Table.Summary.Cell index={0}>{t('quota_dashboard.total')}</Table.Summary.Cell>
      <Table.Summary.Cell index={1} align="right">{fmtKg(totals.sales_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={2} align="right">{fmtKg(totals.expected_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={3} align="right">{fmtKg(totals.issued_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={4} align="right">{fmtKg(totals.used_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={5} align="right">
        <span style={{ color: totals.not_given_kg > 0 ? '#ff4d4f' : undefined }}>
          {fmtKg(totals.not_given_kg)}
        </span>
      </Table.Summary.Cell>
      <Table.Summary.Cell index={6} align="right">—</Table.Summary.Cell>
      <Table.Summary.Cell index={7} align="right">
        <span style={{ color: totals.unused_kg > 0 ? '#fa8c16' : undefined }}>
          {fmtKg(totals.unused_kg)}
        </span>
      </Table.Summary.Cell>
      <Table.Summary.Cell index={8} align="right">
        <span style={{ color: Object.values(expiredPerFirm).reduce((s, v) => s + v, 0) > 0 ? '#ff4d4f' : undefined }}>
          {fmtKg(Object.values(expiredPerFirm).reduce((s, v) => s + v, 0))}
        </span>
      </Table.Summary.Cell>
    </Table.Summary.Row>
  );

  return (
    <Table<IQuotaDashboardFirm>
      dataSource={sorted}
      columns={columns}
      rowKey="export_firm"
      size="small"
      pagination={false}
      summary={() => summaryRow}
      rowClassName={(row) => (row.is_blocked ? 'quota-row-blocked' : '')}
      onRow={(row) => ({
        style: row.is_blocked ? { background: '#fff1f0' } : undefined,
      })}
    />
  );
}
