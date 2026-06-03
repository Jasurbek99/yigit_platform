import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Descriptions, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useContract } from '@/hooks/useContracts';
import type { ContractStatus } from '@/types/contract';
import { COLORS } from '@/constants/styles';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<ContractStatus, string> = {
  active: 'blue',
  completed: 'green',
  closed: 'default',
  cancelled: 'red',
};

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export default function ContractDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const contractId = id ? parseInt(id, 10) : 0;

  const { data: contract, isLoading, isError } = useContract(contractId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || !contract) {
    return (
      <Alert
        message={t('common.load_error')}
        type="error"
        style={{ marginTop: 40 }}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/contracts')}
        />
        <Title level={4} style={{ margin: 0 }}>
          {contract.contract_number}
        </Title>
        <Tag color={STATUS_COLORS[contract.status] ?? 'default'}>
          {t(`contracts.status.${contract.status}`)}
        </Tag>
      </div>

      {/* Placeholder notice */}
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        {t('contracts.detail.placeholder')}
      </Text>

      {/* Basic info */}
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        style={{ background: COLORS.white }}
      >
        <Descriptions.Item label={t('contracts.column.contract_number')}>
          {contract.contract_number}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.seller')}>
          {contract.export_firm_name ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.buyer')}>
          {contract.import_firm_name ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.create.field.season')}>
          {contract.season_name ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.incoterm')}>
          {contract.incoterm}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.status')}>
          <Tag color={STATUS_COLORS[contract.status] ?? 'default'}>
            {t(`contracts.status.${contract.status}`)}
          </Tag>
        </Descriptions.Item>

        <Descriptions.Item label={t('contracts.column.planned_trucks')}>
          {fmt(contract.planned_trucks)}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.planned_quantity_kg')}>
          {fmt(contract.planned_quantity_kg)} kg
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.planned_amount_usd')}>
          ${fmt(contract.planned_amount_usd)}
        </Descriptions.Item>

        <Descriptions.Item label={t('contracts.column.exported_trucks')}>
          {fmt(contract.exported_trucks)}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.exported_quantity_kg')}>
          {fmt(contract.exported_quantity_kg)} kg
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.exported_amount_usd')}>
          ${fmt(contract.exported_amount_usd)}
        </Descriptions.Item>

        <Descriptions.Item label={t('contracts.column.trucks_remaining')}>
          {fmt(contract.trucks_remaining)}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.quantity_remaining_kg')}>
          {fmt(contract.quantity_remaining_kg)} kg
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.payment_received_usd')}>
          ${fmt(contract.payment_received_usd)}
        </Descriptions.Item>

        <Descriptions.Item label={t('contracts.column.ostatok_usd')}>
          ${fmt(contract.ostatok_usd)}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.create.field.start_date')}>
          {contract.start_date ? dayjs(contract.start_date).format('DD.MM.YYYY') : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.create.field.end_date')}>
          {contract.end_date ? dayjs(contract.end_date).format('DD.MM.YYYY') : '—'}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}
