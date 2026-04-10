import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Dayjs } from 'dayjs';
import { useAdminFirms } from '@/hooks/useAdmin';
import {
  useCreateQuotaIssuance,
  type ICreateIssuancePayload,
} from '@/hooks/useQuotaDashboard';

const { Title, Text } = Typography;

interface IFormValues {
  issue_date: Dayjs;
  product_type: string;
  validity: string;
  notes?: string;
}

export default function AddQuotaIssuance() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<IFormValues>();
  const { data: firms = [] } = useAdminFirms();
  const createMutation = useCreateQuotaIssuance();

  const activeFirms = firms.filter((f) => f.is_active);

  // Per-firm allocations stored in local state (not in antd form — cleaner for table layout)
  const [allocations, setAllocations] = useState<Record<number, number>>({});

  // Watch issue_date for dynamic month names
  const watchedDate: Dayjs | undefined = Form.useWatch('issue_date', form);
  const hasDate = !!watchedDate;
  const thisMonth = watchedDate ? watchedDate.format('MMMM') : '';
  const nextMonth = watchedDate ? watchedDate.add(1, 'month').format('MMMM') : '';

  const totalKg = Object.values(allocations).reduce((s, v) => s + (v || 0), 0);
  const firmCount = Object.values(allocations).filter((v) => v > 0).length;

  function handleAllocChange(firmId: number, value: number | null) {
    setAllocations((prev) => ({ ...prev, [firmId]: value ?? 0 }));
  }

  function handleSubmit(values: IFormValues) {
    const allocs: ICreateIssuancePayload['allocations'] = [];
    for (const [firmId, kg] of Object.entries(allocations)) {
      if (kg > 0) allocs.push({ export_firm: Number(firmId), kg_quota: kg });
    }

    if (allocs.length === 0) {
      message.warning(t('quota_dashboard.no_firms_selected'));
      return;
    }

    const payload: ICreateIssuancePayload = {
      issue_date: values.issue_date.format('YYYY-MM-DD'),
      product_type: values.product_type,
      validity: values.validity,
      notes: values.notes ?? '',
      allocations: allocs,
    };

    createMutation.mutate(payload, {
      onSuccess: () => {
        message.success(t('quota_dashboard.issuance_created'));
        navigate('/export/quota');
      },
    });
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate('/export/quota')} />
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('quota_dashboard.add_issuance_title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('quota_dashboard.add_issuance_desc')}</Text>
        </div>
      </div>

      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        {/* Top row: date + product + validity */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="issue_date"
                label={t('quota_dashboard.issue_date')}
                rules={[{ required: true, message: t('common.required') }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="product_type"
                label={t('quota_dashboard.product_type')}
                rules={[{ required: true, message: t('common.required') }]}
                initialValue="tomato"
              >
                <Select
                  options={[
                    { value: 'tomato', label: t('quota_dashboard.product_tomato') },
                    { value: 'pepper', label: t('quota_dashboard.product_pepper') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="validity"
                label={t('quota_dashboard.validity')}
                rules={[{ required: true, message: t('common.required') }]}
                initialValue="this_month"
              >
                <Select
                  disabled={!hasDate}
                  placeholder={hasDate ? undefined : t('quota_dashboard.select_date_first')}
                  options={hasDate ? [
                    { value: 'this_month', label: `${thisMonth} ${t('quota_dashboard.only')}` },
                    { value: 'this_and_next', label: `${thisMonth} + ${nextMonth}` },
                    { value: 'next_month', label: `${nextMonth} ${t('quota_dashboard.only')}` },
                  ] : []}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Firm allocations — full-width table-like layout */}
        <Card
          size="small"
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('quota_dashboard.firm_allocations')}</span>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {firmCount} {t('quota_dashboard.firms_selected')} · {totalKg.toLocaleString()} kg
              </Text>
            </div>
          }
          style={{ marginBottom: 16 }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '8px 24px',
            }}
          >
            {activeFirms.map((firm) => (
              <div key={firm.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ width: 160, fontSize: 13, flexShrink: 0 }}>
                  {firm.name_en || firm.name_tk}
                </Text>
                <InputNumber
                  min={0}
                  step={1000}
                  suffix="kg"
                  value={allocations[firm.id] || undefined}
                  onChange={(v) => handleAllocChange(firm.id, v)}
                  placeholder="0"
                  style={{ width: '100%' }}
                  size="small"
                />
              </div>
            ))}
          </div>
        </Card>

        {/* Notes — at the bottom, optional */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="notes" label={t('quota_dashboard.notes')} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder={t('quota_dashboard.notes_placeholder')} />
          </Form.Item>
        </Card>

        {/* Submit */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => navigate('/export/quota')}>{t('common.cancel')}</Button>
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            {t('quota_dashboard.add_issuance')}
          </Button>
        </div>
      </Form>
    </div>
  );
}
