import { useState } from 'react';
import { Modal, List, Radio, Empty, Typography, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDrafts, useJoinShipments } from '@/hooks/useDrafts';
import { FONT } from '@/constants/styles';
import type { IShipmentDraft } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────

interface IJoinSupplyModalProps {
  readonly open: boolean;
  readonly targetId: number;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Draft-list payload has no raw country/customer FK ids — only *_name
// strings (see IShipmentDraft's Join-supply comment). A "complete
// destination" is one with both names set; anything else with block_sources
// is a supply candidate.
function isSupplyCandidate(d: IShipmentDraft, targetId: number): boolean {
  return d.id !== targetId
    && d.block_sources.length > 0
    && !(d.country_name != null && d.customer_name != null);
}

// ─── Component ────────────────────────────────────────────────────────────

/** Modal to pick a supply draft and merge it into a destination draft (`targetId`). */
export function JoinSupplyModal({ open, targetId, onClose, onSuccess }: IJoinSupplyModalProps) {
  const { t } = useTranslation();
  const { data: drafts, isLoading } = useDrafts();
  const joinMutation = useJoinShipments();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const candidates = (drafts ?? []).filter((d) => isSupplyCandidate(d, targetId));

  function handleClose() {
    setSelectedId(null);
    onClose();
  }

  function handleJoin() {
    if (selectedId == null) return;
    joinMutation.mutate(
      { targetId, sourceId: selectedId },
      {
        onSuccess: () => {
          toast.success(t('join_supply.toast_success'));
          setSelectedId(null);
          onSuccess?.();
          onClose();
        },
        onError: (err) => {
          const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
          toast.error(msg ?? t('join_supply.toast_error'));
        },
      },
    );
  }

  return (
    <Modal
      title={t('join_supply.title')}
      open={open}
      onCancel={handleClose}
      onOk={handleJoin}
      okText={t('join_supply.join_button')}
      cancelText={t('join_supply.cancel')}
      okButtonProps={{ disabled: selectedId == null }}
      confirmLoading={joinMutation.isPending}
      destroyOnHidden
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : candidates.length === 0 ? (
        <Empty description={t('join_supply.empty')} />
      ) : (
        <Radio.Group
          value={selectedId}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          style={{ width: '100%' }}
        >
          <List
            dataSource={candidates}
            renderItem={(d) => (
              <List.Item key={d.id}>
                <Radio value={d.id} style={{ width: '100%' }}>
                  <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                    {d.shipment_code}
                  </Typography.Text>
                  <span style={{ marginLeft: 8, color: '#475467', fontSize: 12 }}>
                    {t('join_supply.col_blocks')}: {d.block_sources.map((b) => b.block_code).join(', ')}
                    {d.weight_net != null &&
                      ` · ${t('join_supply.col_weight')}: ${Number(d.weight_net).toLocaleString('ru-RU')} kg`}
                  </span>
                </Radio>
              </List.Item>
            )}
          />
        </Radio.Group>
      )}
    </Modal>
  );
}
