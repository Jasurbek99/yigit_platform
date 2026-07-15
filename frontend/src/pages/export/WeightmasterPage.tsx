import { useState } from 'react';
import { Card, Flex, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { useShipments } from '@/hooks/useShipments';
import { useAuth } from '@/hooks/useAuth';
import { ShipmentSelect } from '@/components/ShipmentSelect';
import { PalletManifestPanel } from './pallet/PalletManifestPanel';
import type { IShipmentListItem } from '@/types';
import { FONT } from '@/constants/styles';

const { Title, Text } = Typography;

/**
 * Standalone weightmaster workspace: a queue of trucks in the loading phase plus
 * a truck picker, with the pallet-manifest editor (weightmaster Excel upload +
 * grid + block breakdown) rendered inline for the selected truck — no need to
 * drill into a shipment detail first.
 */
export default function WeightmasterPage() {
  const { t } = useTranslation();
  useAuth();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Queue: trucks currently in the LOADING phase (what the weightmaster weighs).
  const { data, isLoading } = useShipments({ phase: 'LOADING', page_size: 50 });
  const queue = data?.results ?? [];

  const columns: ColumnsType<IShipmentListItem> = [
    {
      title: t('weightmaster.col_truck'),
      dataIndex: 'shipment_code',
      render: (code: string) => <span style={{ fontFamily: FONT.mono }}>{code}</span>,
    },
    { title: t('weightmaster.col_date'), dataIndex: 'date', responsive: ['md'] },
    { title: t('weightmaster.col_customer'), dataIndex: 'customer_name', responsive: ['md'] },
    {
      title: t('weightmaster.col_status'),
      dataIndex: 'status_display',
      render: (s: string) => <Tag>{s}</Tag>,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Flex align="center" gap={16} wrap="wrap" style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('weightmaster.title')}</Title>
        <ShipmentSelect
          value={selectedId}
          onChange={setSelectedId}
          placeholder={t('weightmaster.pick_truck')}
          style={{ minWidth: 320 }}
        />
      </Flex>

      <Card title={t('weightmaster.queue_title')} style={{ marginBottom: 16 }}>
        <Table<IShipmentListItem>
          size="small"
          loading={isLoading}
          rowKey="id"
          columns={columns}
          dataSource={queue}
          pagination={false}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? 'rgba(24,144,255,0.08)' : undefined,
            },
          })}
          locale={{ emptyText: t('weightmaster.queue_empty') }}
        />
      </Card>

      {selectedId != null ? (
        <Card
          title={
            <span>
              {t('pallet.title')} —{' '}
              <span style={{ fontFamily: FONT.mono }}>
                {queue.find((s) => s.id === selectedId)?.shipment_code ?? `#${selectedId}`}
              </span>
            </span>
          }
        >
          {/* key remounts the panel on truck switch so local row state resets. */}
          <PalletManifestPanel key={selectedId} shipmentId={selectedId} />
        </Card>
      ) : (
        <Text type="secondary">{t('weightmaster.select_hint')}</Text>
      )}
    </div>
  );
}
