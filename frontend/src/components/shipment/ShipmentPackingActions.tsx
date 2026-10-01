import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUnjoinPackaging } from '@/hooks/useDrafts';
import { useAuth } from '@/hooks/useAuth';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { canUserJoin, isPreLoading } from '@/components/sheet/joinHelpers';
import { SwapPackingModal } from '@/components/shipment/SwapPackingModal';
import type { IShipmentDetail } from '@/types';

type PackingSubject = Pick<IShipmentDetail, 'status_code' | 'block_sources' | 'country' | 'customer'>;

/**
 * Which packing moves this user may start from the Detail page. Mirrors the
 * backend (services/packaging.py): before loading, the row has packing, a
 * JOIN_ROLES user; unjoin also needs a destination — a supply plan has
 * nothing to detach from.
 */
export function packingActions(
  shipment: PackingSubject,
  user: { role?: string | null; is_superuser?: boolean } | null,
): { canSwap: boolean; canUnjoin: boolean } {
  const canSwap = canUserJoin(user) && isPreLoading(shipment.status_code) && shipment.block_sources.length > 0;
  return { canSwap, canUnjoin: canSwap && shipment.country != null && shipment.customer != null };
}

interface IShipmentPackingActionsProps {
  shipment: IShipmentDetail;
  readOnly: boolean;
}

/** «Отсоединить» / «Поменять упаковку» for the packaging part (spec 2026-09-30 §2). */
export function ShipmentPackingActions({ shipment, readOnly }: IShipmentPackingActionsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unjoin = useUnjoinPackaging();
  const [swapOpen, setSwapOpen] = useState(false);
  const { canSwap, canUnjoin } = packingActions(shipment, user);
  if (readOnly || !canSwap) return null;

  const confirmUnjoin = () => Modal.confirm({
    title: t('packing.confirm_unjoin_title'),
    content: t('packing.confirm_unjoin_body', { a: shipment.shipment_code }),
    okText: t('packing.confirm_ok'),
    cancelText: t('packing.confirm_cancel'),
    onOk: () => unjoin.mutate(shipment.id, {
      onSuccess: (data) => toast.success(t('packing.toast_unjoined', { code: data.new_supply_code })),
      onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
    }),
  });

  return (
    <Space style={{ margin: '6px 0' }}>
      {canUnjoin && (
        <Button size="small" loading={unjoin.isPending} onClick={confirmUnjoin}>{t('packing.btn_unjoin')}</Button>
      )}
      <Button size="small" onClick={() => setSwapOpen(true)}>{t('packing.btn_swap')}</Button>
      {swapOpen && <SwapPackingModal shipment={shipment} onClose={() => setSwapOpen(false)} />}
    </Space>
  );
}
