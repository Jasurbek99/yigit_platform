import { Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type {
  IClientsReportRow,
  IClientsReportMonth,
  IClientsReportTotals,
} from '@/hooks/useClientsReport';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IProps {
  rows: IClientsReportRow[];
  months: IClientsReportMonth[];
  totals: IClientsReportTotals;
}

/** Localized "Oktýabr-2025" label from numeric year + month (1-12). */
function useMonthLabel() {
  const { t } = useTranslation();
  const names = t('clients_report.months', { returnObjects: true }) as string[];
  return (m: IClientsReportMonth) => `${names[m.month - 1] ?? m.month}-${m.year}`;
}

const num = (v: number) => v.toLocaleString();
const tons = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}t`;

function Cell({ trucks, tonnage }: { trucks: number; tonnage: number }) {
  if (!trucks) return <Text type="secondary">—</Text>;
  return (
    <div style={{ lineHeight: 1.2 }}>
      <div style={{ fontWeight: 500 }}>{num(trucks)}</div>
      <Text type="secondary" style={{ fontSize: 11 }}>{tons(tonnage)}</Text>
    </div>
  );
}

export function ClientsMatrixTable({ rows, months, totals }: IProps) {
  const { t } = useTranslation();
  const monthLabel = useMonthLabel();

  const columns: ColumnsType<IClientsReportRow> = [
    {
      title: t('clients_report.col_client'),
      dataIndex: 'customer_name',
      key: 'customer_name',
      fixed: 'left',
      width: 160,
      render: (v: string) => <Text strong>{v}</Text>,
      sorter: (a, b) => a.customer_name.localeCompare(b.customer_name),
    },
    {
      title: t('clients_report.col_market'),
      dataIndex: 'country_name',
      key: 'country_name',
      width: 120,
      render: (v: string) => v || <Text type="secondary">—</Text>,
      sorter: (a, b) => (a.country_name || '').localeCompare(b.country_name || ''),
    },
    {
      title: t('clients_report.col_total'),
      dataIndex: 'total_trucks',
      key: 'total_trucks',
      width: 90,
      align: 'right',
      fixed: 'left',
      defaultSortOrder: 'descend',
      render: (_: number, r) => <Cell trucks={r.total_trucks} tonnage={r.total_tonnage} />,
      sorter: (a, b) => a.total_trucks - b.total_trucks,
    },
    {
      title: t('clients_report.col_share'),
      dataIndex: 'pct',
      key: 'pct',
      width: 80,
      align: 'right',
      render: (v: number) => `${v.toFixed(1)}%`,
      sorter: (a, b) => a.pct - b.pct,
    },
    ...months.map((m) => ({
      title: monthLabel(m),
      key: m.key,
      width: 90,
      align: 'right' as const,
      render: (_: unknown, r: IClientsReportRow) => (
        <Cell trucks={r.monthly[m.key]?.trucks ?? 0} tonnage={r.monthly[m.key]?.tonnage ?? 0} />
      ),
      sorter: (a: IClientsReportRow, b: IClientsReportRow) =>
        (a.monthly[m.key]?.trucks ?? 0) - (b.monthly[m.key]?.trucks ?? 0),
    })),
  ];

  return (
    <Table<IClientsReportRow>
      rowKey={(r) => `${r.customer_id}-${r.country_id ?? 0}`}
      columns={columns}
      dataSource={rows}
      size="small"
      pagination={false}
      scroll={{ x: 'max-content', y: 520 }}
      summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row style={{ background: COLORS.border, fontWeight: 600 }}>
            <Table.Summary.Cell index={0}>{t('clients_report.totals_row')}</Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} align="right">
              <Cell trucks={totals.total_trucks} tonnage={totals.total_tonnage} />
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">100%</Table.Summary.Cell>
            {months.map((m, i) => (
              <Table.Summary.Cell key={m.key} index={4 + i} align="right">
                <Cell
                  trucks={totals.monthly[m.key]?.trucks ?? 0}
                  tonnage={totals.monthly[m.key]?.tonnage ?? 0}
                />
              </Table.Summary.Cell>
            ))}
          </Table.Summary.Row>
        </Table.Summary>
      )}
    />
  );
}
