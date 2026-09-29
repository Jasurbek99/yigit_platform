import { useState } from 'react';
import { isAxiosError } from 'axios';
import { Button, Modal, Select, Space, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAcceptTripChange, useCandidateShipments, useExternalTrips, useMoveTrip, useUnassignTrip,
} from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';

interface ILinkedTripsTabProps {
  canEdit: boolean;
}

export function LinkedTripsTab({ canEdit }: ILinkedTripsTabProps) {
  const { t } = useTranslation();
  const { data: trips = [], isLoading } = useExternalTrips({ linked: true });
  const { data: candidates = [] } = useCandidateShipments();
  const unassign = useUnassignTrip();
  const move = useMoveTrip();
  const accept = useAcceptTripChange();
  const [moving, setMoving] = useState<IExternalTrip | null>(null);
  const [target, setTarget] = useState<number | null>(null);

  const onError = (err: Error) => {
    const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
    toast.error(t(`truck_board.error.${detail ?? 'generic'}`));
  };

  const columns = [
    { title: t('truck_board.col_shipments'), dataIndex: 'shipment_code', key: 'shipment_code' },
    {
      title: t('truck_board.tractor'), key: 'plates',
      render: (_: unknown, trip: IExternalTrip) => `${trip.tractor_plate} / ${trip.trailer_plate}`,
    },
    { title: t('truck_board.driver'), dataIndex: 'driver_full_name', key: 'driver' },
    { title: t('truck_board.trip'), dataIndex: 'status', key: 'status' },
    {
      title: '', key: 'conflict',
      render: (_: unknown, trip: IExternalTrip) => trip.conflict_note && <Tag color="red">{trip.conflict_note}</Tag>,
    },
    {
      title: '', key: 'actions',
      render: (_: unknown, trip: IExternalTrip) => canEdit && (
        <Space>
          <Button size="small" onClick={() => Modal.confirm({
            title: t('truck_board.unlink_confirm'),
            onOk: () => unassign.mutate({ tripId: trip.id }, { onError }),
          })}>
            {t('truck_board.unlink')}
          </Button>
          <Button size="small" onClick={() => { setMoving(trip); setTarget(null); }}>
            {t('truck_board.move')}
          </Button>
          {trip.conflict_note && (
            <Button size="small" danger onClick={() => accept.mutate({ tripId: trip.id }, {
              onSuccess: () => toast.success(t('truck_board.accepted')),
              onError,
            })}>
              {t('truck_board.accept_change')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const moveTargets = moving
    ? candidates.filter((s) => moving.destination_country_code === null
      || s.country_code === moving.destination_country_code)
    : [];

  return (
    <>
      <Table rowKey="id" size="small" loading={isLoading} dataSource={trips} columns={columns} pagination={false} />
      <Modal
        open={moving !== null}
        title={t('truck_board.move')}
        okButtonProps={{ disabled: target === null, loading: move.isPending }}
        onCancel={() => setMoving(null)}
        onOk={() => moving && target !== null && move.mutate(
          { tripId: moving.id, shipmentId: target },
          { onSuccess: () => setMoving(null), onError },
        )}
      >
        <Select
          style={{ width: '100%' }}
          value={target ?? undefined}
          onChange={(value: number) => setTarget(value)}
          options={moveTargets.map((s) => ({ value: s.id, label: `${s.code} · ${s.country_code ?? '—'}` }))}
        />
      </Modal>
    </>
  );
}
