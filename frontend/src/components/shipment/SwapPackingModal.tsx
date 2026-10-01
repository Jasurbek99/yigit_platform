import { useState } from 'react';
import { Empty, List, Modal, Radio, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useJoinBoard, useSwapPackaging } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { isPreLoading } from '@/components/sheet/joinHelpers';
import { FONT } from '@/constants/styles';
import type { IShipmentDetail, IShipmentDraft } from '@/types';

/** Rows this shipment may swap packing with — mirrors the backend swap_packing gates minus pallets/role. */
export function swapCandidates(rows: IShipmentDraft[], currentId: number): IShipmentDraft[] {
  return rows.filter((r) => r.id !== currentId
    && r.block_sources.length > 0
    && isPreLoading(r.status_code ?? ''));
}

interface ISwapPackingModalProps {
  readonly shipment: Pick<IShipmentDetail, 'id' | 'shipment_code'>;
  readonly onClose: () => void;
}

/** Pick the other truck; the two rows exchange their packing (spec 2026-09-29, Detail entry point 2026-09-30). */
export function SwapPackingModal({ shipment, onClose }: ISwapPackingModalProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useJoinBoard();
  const swap = useSwapPackaging();
  const [otherId, setOtherId] = useState<number | null>(null);
  const candidates = swapCandidates(rows, shipment.id);
  const other = candidates.find((r) => r.id === otherId) ?? null;

  function handleOk() {
    if (!other) return;
    Modal.confirm({
      title: t('packing.confirm_swap_title'),
      content: t('packing.confirm_swap_body', { a: shipment.shipment_code, b: other.shipment_code }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: () => swap.mutate(
        { aId: shipment.id, otherId: other.id },
        {
          onSuccess: () => { toast.success(t('packing.toast_swapped')); onClose(); },
          onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
        },
      ),
    });
  }

  return (
    <Modal
      open
      title={t('shipment_detail.parts.swap_title')}
      onCancel={onClose}
      onOk={handleOk}
      okText={t('packing.btn_swap')}
      okButtonProps={{ disabled: other === null }}
      confirmLoading={swap.isPending}
      destroyOnHidden
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : candidates.length === 0 ? (
        <Empty description={t('shipment_detail.parts.swap_empty')} />
      ) : (
        <Radio.Group value={otherId} onChange={(e) => setOtherId(Number(e.target.value))} style={{ width: '100%' }}>
          <List
            dataSource={candidates}
            renderItem={(r) => (
              <List.Item key={r.id}>
                <Radio value={r.id}>
                  <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>{r.shipment_code}</Typography.Text>
                  <span style={{ marginLeft: 8, fontSize: 12 }}>
                    {r.block_sources.map((b) => b.block_code).join(', ')}
                    {r.weight_net != null && ` · ${Number(r.weight_net).toLocaleString('ru-RU')} kg`}
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
