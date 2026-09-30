import { useState } from 'react';
import { Button, Modal, Select, Space, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAcceptTripChange, useCandidateShipments, useExternalTrips, useMoveTrip, useUnassignTrip,
} from '@/hooks/useExternalTrips';
import type { IExternalTrip } from '@/types/externalTrip';
import { apiErrorKey, confirmUnknownCountry } from './truckBoardHelpers';
import { useTripMessages } from './useTripMessages';

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

  const messages = useTripMessages();
  const onError = (err: Error) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`));

  const columns = [
    { title: t('truck_board.col_shipments'), dataIndex: 'shipment_code', key: 'shipment_code' },
    {
      title: t('truck_board.tractor'), key: 'plates',
      render: (_: unknown, trip: IExternalTrip) => `${trip.tractor_plate} / ${trip.trailer_plate}`,
    },
    { title: t('truck_board.driver'), dataIndex: 'driver_full_name', key: 'driver' },
    {
      title: t('truck_board.trip'), key: 'status',
      render: (_: unknown, trip: IExternalTrip) => messages.status(trip.status),
    },
    {
      title: '', key: 'conflict',
      render: (_: unknown, trip: IExternalTrip) => {
        const conflict = messages.conflict(trip);
        return conflict && <Tag color="red">{conflict}</Tag>;
      },
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
          {trip.conflict_kind && (
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
        onOk={() => {
          if (!moving || target === null) return;
          const doMove = (confirmUnknownCountry: boolean) => move.mutate(
            { tripId: moving.id, shipmentId: target, confirmUnknownCountry },
            { onSuccess: () => setMoving(null), onError },
          );
          if (moving.destination_country_code === null) {
            confirmUnknownCountry(t, () => doMove(true));
          } else {
            doMove(false);
          }
        }}
      >
        <Select
          style={{ width: '100%' }}
          value={target ?? undefined}
          onChange={(value: number) => setTarget(value)}
          options={moveTargets.map((s) => ({ value: s.id, label: `${s.shipment_code} · ${s.country_code ?? '—'}` }))}
        />
      </Modal>
    </>
  );
}
