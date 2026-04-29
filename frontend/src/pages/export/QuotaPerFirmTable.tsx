import { Progress, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IQuotaDashboardFirm } from '@/types';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';

interface IProps {
  data: IQuotaDashboardFirm[];
  expiredPerFirm?: Record<number, number>;
  weightUnit: WeightUnit;
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

function shortfallColor(pct: number): string {
  if (pct > 30) return '#ff4d4f';
  if (pct > 15) return '#fa8c16';
  return '#52c41a';
}

export function QuotaPerFirmTable({ data, expiredPerFirm = {}, weightUnit }: IProps) {
  const fw = (v: number) => fmtWeight(v, weightUnit);
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
      title: `${t('quota_dashboard.sales')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'sales_kg',
      key: 'sales_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.sales_kg - b.sales_kg,
    },
    {
      title: t('quota_dashboard.expected'),
      dataIndex: 'expected_kg',
      key: 'expected_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.expected_kg - b.expected_kg,
    },
    {
      title: t('quota_dashboard.issued'),
      dataIndex: 'issued_kg',
      key: 'issued_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.issued_kg - b.issued_kg,
    },
    {
      title: t('quota_dashboard.used'),
      dataIndex: 'used_kg',
      key: 'used_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
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
          {fw(v)}
        </span>
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.not_given_kg - b.not_given_kg,
    },
    {
      title: t('quota_dashboard.shortfall'),
      key: 'shortfall_bar',
      width: 120,
      render: (_: unknown, row: IQuotaDashboardFirm) => (
        <Progress
          percent={Math.min(Math.round(row.not_given_pct), 100)}
          size="small"
          strokeColor={shortfallColor(row.not_given_pct)}
          format={(pct) => `${pct}%`}
        />
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.not_given_pct - b.not_given_pct,
    },
    {
      title: t('quota_dashboard.unused'),
      dataIndex: 'unused_kg',
      key: 'unused_kg',
      align: 'right' as const,
      responsive: ['lg' as const],
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#fa8c16' : undefined }}>{fw(v)}</span>
      ),
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) => a.unused_kg - b.unused_kg,
    },
    {
      title: t('quota_dashboard.expired_unused'),
      key: 'expired_unused',
      align: 'right' as const,
      responsive: ['lg' as const],
      render: (_: unknown, row: IQuotaDashboardFirm) => {
        const v = expiredPerFirm[row.export_firm] ?? 0;
        return <span style={{ color: v > 0 ? '#ff4d4f' : undefined }}>{fw(v)}</span>;
      },
      sorter: (a: IQuotaDashboardFirm, b: IQuotaDashboardFirm) =>
        (expiredPerFirm[a.export_firm] ?? 0) - (expiredPerFirm[b.export_firm] ?? 0),
    },
  ];

  const totalExpired = Object.values(expiredPerFirm).reduce((s, v) => s + v, 0);

  const summaryRow = (
    <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
      <Table.Summary.Cell index={0}>{t('quota_dashboard.total')}</Table.Summary.Cell>
      <Table.Summary.Cell index={1} align="right">{fw(totals.sales_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={2} align="right">{fw(totals.expected_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={3} align="right">{fw(totals.issued_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={4} align="right">{fw(totals.used_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={5} align="right">
        <span style={{ color: totals.not_given_kg > 0 ? '#ff4d4f' : undefined }}>
          {fw(totals.not_given_kg)}
        </span>
      </Table.Summary.Cell>
      <Table.Summary.Cell index={6}>—</Table.Summary.Cell>
      <Table.Summary.Cell index={7} align="right">
        <span style={{ color: totals.unused_kg > 0 ? '#fa8c16' : undefined }}>
          {fw(totals.unused_kg)}
        </span>
      </Table.Summary.Cell>
      <Table.Summary.Cell index={8} align="right">
        <span style={{ color: totalExpired > 0 ? '#ff4d4f' : undefined }}>
          {fw(totalExpired)}
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
      scroll={{ x: 'max-content' }}
      summary={() => summaryRow}
      rowClassName={(row) => (row.is_blocked ? 'quota-row-blocked' : '')}
      onRow={(row) => ({
        style: {
          ...(row.is_blocked ? { background: '#fff1f0' } : undefined),
          ...(row.not_given_pct > 30 ? { borderLeft: '3px solid #ff4d4f' } : undefined),
        },
      })}
    />
  );
}
