import { useState, useEffect } from 'react';
import { Select, Button, Alert, Space, Typography, Empty } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { IconUsers } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSalesRepCoverage, useSaveSalesRepCoverage } from '@/hooks/useSalesRepCoverage';
import { useCustomers } from '@/hooks/useAdmin';
import type { ISalesRepCoverage } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

// ─── Row-level editor ─────────────────────────────────────────────────────────

interface IRepRowProps {
  readonly row: ISalesRepCoverage;
  readonly customerOptions: { value: number; label: string }[];
}

function RepRow({ row, customerOptions }: IRepRowProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number[]>(row.customer_ids);
  const [dirty, setDirty] = useState(false);

  // Sync if server data changes (e.g. another row save moved a customer here)
  useEffect(() => {
    setSelected(row.customer_ids);
    setDirty(false);
  }, [row.customer_ids]);

  const saveMutation = useSaveSalesRepCoverage();

  function handleChange(values: number[]) {
    setSelected(values);
    setDirty(true);
  }

  function handleSave() {
    saveMutation.mutate(
      { userId: row.sales_rep, customerIds: selected },
      {
        onSuccess: () => {
          toast.success(t('sales_rep_coverage.toast_saved', { name: row.sales_rep_name }));
          setDirty(false);
        },
        onError: () => toast.error(t('sales_rep_coverage.toast_error')),
      },
    );
  }

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Select
        mode="multiple"
        value={selected}
        onChange={handleChange}
        options={customerOptions}
        placeholder={t('sales_rep_coverage.customers_placeholder')}
        style={{ flex: 1 }}
        showSearch
        filterOption={(input, opt) =>
          String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        maxTagCount="responsive"
      />
      <Button
        type="primary"
        onClick={handleSave}
        loading={saveMutation.isPending}
        disabled={!dirty}
      >
        {t('sales_rep_coverage.save')}
      </Button>
    </Space.Compact>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesRepCoveragePage() {
  const { t } = useTranslation();

  const { data: coverage = [], isLoading, isError } = useSalesRepCoverage();
  const { data: customers = [] } = useCustomers();

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const columns: ProColumns<ISalesRepCoverage>[] = [
    {
      title: t('sales_rep_coverage.col_name'),
      dataIndex: 'sales_rep_name',
      width: 180,
      search: false,
      render: (_, record) => <Text strong>{record.sales_rep_name}</Text>,
    },
    {
      title: t('sales_rep_coverage.col_customers'),
      key: 'customers',
      search: false,
      render: (_, record) => (
        <RepRow row={record} customerOptions={customerOptions} />
      ),
    },
  ];

  if (isError) {
    return (
      <Alert
        type="error"
        message={t('sales_rep_coverage.error_load')}
        showIcon
        style={{ margin: 16 }}
      />
    );
  }

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
          <IconUsers style={{ color: COLORS.primary }} />
          {t('sales_rep_coverage.title')}
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
          {t('sales_rep_coverage.subtitle')}
        </div>
      </div>

      <ProTable<ISalesRepCoverage>
        rowKey="sales_rep"
        dataSource={coverage}
        loading={isLoading}
        columns={columns}
        search={false}
        options={false}
        toolBarRender={false}
        pagination={false}
        size="middle"
        scroll={{ x: 600 }}
        locale={{ emptyText: <Empty description={t('sales_rep_coverage.no_reps_hint')} /> }}
      />
    </div>
  );
}
