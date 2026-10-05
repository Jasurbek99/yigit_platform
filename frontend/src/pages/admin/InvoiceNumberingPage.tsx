import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, InputNumber, Space, Table, Typography } from 'antd';
import { ArrowLeftOutlined, NumberOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  useInvoiceNumberBases, useSaveInvoiceNumberBase, type IInvoiceNumberBaseRow,
} from '@/hooks/useInvoiceNumberBases';
import { useLetterNumberBases, useSaveLetterNumberBase, type LetterType } from '@/hooks/useLetterNumberBases';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

/**
 * «Нумерация инвойсов» (`/admin/invoice-numbering`) — the last invoice number
 * each export firm issued outside the platform this year. New invoices continue
 * above it. Reached from the export-firm list, like legal forms; editing is
 * admin-only because the floor decides which numbers new invoices get.
 */
export default function InvoiceNumberingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.is_superuser === true;
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const { data: rows, isLoading } = useInvoiceNumberBases(year);
  const save = useSaveInvoiceNumberBase();
  const { data: letterRows } = useLetterNumberBases(year);
  const saveLetter = useSaveLetterNumberBase();
  const letterByFirm = new Map((letterRows ?? []).map((r) => [r.export_firm, r]));

  const commit = (row: IInvoiceNumberBaseRow, value: number | null) => {
    if (value == null || value === row.last_number) return;
    save.mutate(
      { export_firm: row.export_firm, year, last_number: value },
      {
        onSuccess: () => toast.success(t('invoice_numbering.saved')),
        onError: () => toast.error(t('invoice_numbering.save_error')),
      },
    );
  };

  const commitLetter = (firmId: number, type: LetterType, current: number, value: number | null) => {
    if (value == null || value === current) return;
    saveLetter.mutate(
      { export_firm: firmId, year, letter_type: type, last_number: value },
      {
        onSuccess: () => toast.success(t('invoice_numbering.saved')),
        onError: () => toast.error(t('invoice_numbering.save_error')),
      },
    );
  };

  // CT-1 / Fito / ARZA request letters count separately, per firm and year (spec 2026-10-05).
  const letterColumn = (type: LetterType, titleKey: string) => ({
    title: t(titleKey),
    key: type,
    render: (_: unknown, row: IInvoiceNumberBaseRow) => {
      const value = letterByFirm.get(row.export_firm)?.[type] ?? 0;
      return canWrite ? (
        <InputNumber
          key={`${row.export_firm}-${year}-${type}-${value}`}
          min={0}
          precision={0}
          defaultValue={value}
          onBlur={(e) => commitLetter(row.export_firm, type, value, e.target.value === '' ? null : Number(e.target.value))}
          onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
        />
      ) : (
        value
      );
    },
  });

  return (
    <div>
      <Space align="center" size={8} style={{ marginBottom: 4 }}>
        <Button icon={<ArrowLeftOutlined />} size="small" onClick={() => navigate(-1)} aria-label={t('common.back')} />
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <NumberOutlined style={{ color: COLORS.primary }} />
          {t('invoice_numbering.title')}
        </Title>
      </Space>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        {t('invoice_numbering.subtitle')}
      </Text>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('invoice_numbering.floor_warning')} />
      <Space style={{ marginBottom: 12 }}>
        <Text>{t('invoice_numbering.year')}</Text>
        <InputNumber min={2000} max={2100} value={year} onChange={(v) => v && setYear(v)} />
      </Space>
      <Table<IInvoiceNumberBaseRow>
        rowKey="export_firm"
        size="small"
        loading={isLoading}
        dataSource={rows ?? []}
        pagination={false}
        columns={[
          { title: t('invoice_numbering.col_firm'), dataIndex: 'export_firm_code' },
          { title: t('invoice_numbering.col_name'), dataIndex: 'export_firm_name' },
          {
            title: t('invoice_numbering.col_last_number'),
            dataIndex: 'last_number',
            render: (value: number, row) =>
              canWrite ? (
                <InputNumber
                  key={`${row.export_firm}-${year}-${value}`}
                  min={0}
                  precision={0}
                  defaultValue={value}
                  onBlur={(e) => commit(row, e.target.value === '' ? null : Number(e.target.value))}
                  onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                />
              ) : (
                value
              ),
          },
          letterColumn('ct1', 'invoice_numbering.col_ct1'),
          letterColumn('fito', 'invoice_numbering.col_fito'),
          letterColumn('customs', 'invoice_numbering.col_customs'),
        ]}
      />
    </div>
  );
}
