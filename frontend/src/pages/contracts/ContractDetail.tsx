import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useContract } from '@/hooks/useContracts';
import { useAuth } from '@/hooks/useAuth';
import { InvoicesTab } from './InvoicesTab';
import type { ContractStatus } from '@/types/contract';
import { COLORS } from '@/constants/styles';

const { Title } = Typography;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

// ─── Placeholder tab ─────────────────────────────────────────────────────────

function ComingSoonTab() {
  return (
    <Empty
      description="Coming soon"
      style={{ padding: '48px 0' }}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContractDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const contractId = id ? parseInt(id, 10) : 0;

  const { data: contract, isLoading, isError } = useContract(contractId);
  const { user } = useAuth();

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

  // ─── Tab items ─────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'invoices',
      label: t('contracts.detail.tab.invoices'),
      children: (
        <InvoicesTab
          contractId={contractId}
          currentUser={user}
        />
      ),
    },
    {
      key: 'payments',
      label: t('contracts.detail.tab.payments'),
      children: <ComingSoonTab />,
    },
    {
      key: 'passports',
      label: t('contracts.detail.tab.passports'),
      children: <ComingSoonTab />,
    },
    {
      key: 'comments',
      label: t('contracts.detail.tab.comments'),
      children: <ComingSoonTab />,
    },
  ];

  return (
    <div>
      {/* Back button + title row */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/contracts')}
        >
          {t('contracts.detail.back_to_list')}
        </Button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          {contract.contract_number}
        </Title>
        <Tag color={STATUS_COLORS[contract.status] ?? 'default'}>
          {t(`contracts.status.${contract.status}`)}
        </Tag>
      </div>

      {/* ── Header Descriptions ─────────────────────────────────────────────── */}
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        style={{ background: COLORS.white, marginBottom: 24 }}
      >
        {/* Identity row */}
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
          {contract.incoterm || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('contracts.column.status')}>
          <Tag color={STATUS_COLORS[contract.status] ?? 'default'}>
            {t(`contracts.status.${contract.status}`)}
          </Tag>
        </Descriptions.Item>

        {/* Planlanan group */}
        <Descriptions.Item label={`${t('contracts.detail.group.planned')} — ${t('contracts.column.planned_trucks')}`}>
          {fmt(contract.planned_trucks)}
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.planned')} — ${t('contracts.column.planned_quantity_kg')}`}>
          {fmt(contract.planned_quantity_kg)} kg
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.planned')} — ${t('contracts.column.planned_amount_usd')}`}>
          ${fmt(contract.planned_amount_usd)}
        </Descriptions.Item>

        {/* Eksport edilen group */}
        <Descriptions.Item label={`${t('contracts.detail.group.exported')} — ${t('contracts.column.exported_trucks')}`}>
          {fmt(contract.exported_trucks)}
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.exported')} — ${t('contracts.column.exported_quantity_kg')}`}>
          {fmt(contract.exported_quantity_kg)} kg
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.exported')} — ${t('contracts.column.exported_amount_usd')}`}>
          ${fmt(contract.exported_amount_usd)}
        </Descriptions.Item>

        {/* Galan group */}
        <Descriptions.Item label={`${t('contracts.detail.group.remaining')} — ${t('contracts.column.trucks_remaining')}`}>
          {fmt(contract.trucks_remaining)}
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.remaining')} — ${t('contracts.column.quantity_remaining_kg')}`}>
          {fmt(contract.quantity_remaining_kg)} kg
        </Descriptions.Item>

        {/* Tölegler group */}
        <Descriptions.Item label={`${t('contracts.detail.group.payments')} — ${t('contracts.column.payment_received_usd')}`}>
          ${fmt(contract.payment_received_usd)}
        </Descriptions.Item>
        <Descriptions.Item label={`${t('contracts.detail.group.payments')} — ${t('contracts.column.ostatok_usd')}`}>
          ${fmt(contract.ostatok_usd)}
        </Descriptions.Item>

        {/* Dates */}
        <Descriptions.Item label={t('contracts.detail.group.dates')}>
          {fmtDate(contract.start_date)} — {fmtDate(contract.end_date)}
        </Descriptions.Item>
      </Descriptions>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <Tabs
        defaultActiveKey="invoices"
        items={tabItems}
        destroyInactiveTabPane={false}
      />
    </div>
  );
}
