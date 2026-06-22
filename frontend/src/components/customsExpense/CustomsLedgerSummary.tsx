import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ICustomsLedger, ICustomsLedgerByCategoryRow } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

function formatTmt(value: string | undefined): string {
  if (!value) return '0 TMT';
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TMT`;
}

interface ICustomsLedgerSummaryProps {
  ledger: ICustomsLedger | undefined;
  isLoading: boolean;
}

export function CustomsLedgerSummary({ ledger, isLoading }: ICustomsLedgerSummaryProps): React.ReactElement {
  const { t } = useTranslation();

  const balance = ledger ? Number(ledger.balance) : 0;
  const balanceColor = balance < 0 ? COLORS.danger : COLORS.success;

  const categoryColumns: TableColumnsType<ICustomsLedgerByCategoryRow> = [
    {
      title: t('customs_expense.col_category'),
      dataIndex: 'category',
      key: 'category',
      render: (_, row) => (
        <Text>{t(`customs_expense.category.${row.category}`, { defaultValue: row.category_display })}</Text>
      ),
    },
    {
      title: t('customs_expense.col_amount'),
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (v: string) => <Text strong>{formatTmt(v)}</Text>,
    },
    {
      title: t('customs_expense.col_quantity'),
      dataIndex: 'count',
      key: 'count',
      align: 'right',
      render: (v: number) => <Tag>{v}</Tag>,
    },
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title={t('customs_expense.ledger_advances')}
              value={ledger ? Number(ledger.advances_total) : 0}
              suffix="TMT"
              precision={2}
              valueStyle={{ color: COLORS.success }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title={t('customs_expense.ledger_expenses')}
              value={ledger ? Number(ledger.expenses_total) : 0}
              suffix="TMT"
              precision={2}
              valueStyle={{ color: COLORS.danger }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title={t('customs_expense.ledger_balance')}
              value={Math.abs(balance)}
              prefix={balance < 0 ? '-' : ''}
              suffix="TMT"
              precision={2}
              valueStyle={{ color: balanceColor }}
            />
          </Card>
        </Col>
      </Row>

      {ledger && ledger.by_category.length > 0 && (
        <Card
          size="small"
          title={<Text style={{ fontSize: 13, fontWeight: 600 }}>{t('customs_expense.ledger_by_category')}</Text>}
          styles={{ body: { padding: 0 } }}
        >
          <Table<ICustomsLedgerByCategoryRow>
            rowKey="category"
            dataSource={ledger.by_category}
            columns={categoryColumns}
            pagination={false}
            size="small"
            loading={isLoading}
          />
        </Card>
      )}
    </div>
  );
}
