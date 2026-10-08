import { useState } from 'react';
import { Empty, List, Modal, Radio, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAssignTrip, useExternalTrips } from '@/hooks/useExternalTrips';
import { apiErrorKey } from '@/pages/export/truckBoard/truckBoardHelpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { FONT } from '@/constants/styles';
import type { IShipmentDetail } from '@/types';

/** A trip bound for another country can't take this shipment; an unknown country can, after a confirm. */
export function tripCountryMismatch(tripCountry: string | null, shipmentCountry: string | null): boolean {
  return tripCountry !== null && tripCountry !== shipmentCountry;
}

interface ITripPickerModalProps {
  readonly shipment: Pick<IShipmentDetail, 'id' | 'country_code'>;
  readonly onClose: () => void;
}

/**
 * Pick a free Planning trip for this shipment (spec 2026-09-30 §1) — the same
 * assign the Truck Board does. Mount it only while open: the free-trip list
 * polls every 60 s.
 */
export function TripPickerModal({ shipment, onClose }: ITripPickerModalProps) {
  const { t } = useTranslation();
  const { data: trips = [], isLoading } = useExternalTrips({ free: true });
  const assign = useAssignTrip();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = trips.find((trip) => trip.id === selectedId) ?? null;

  function submit(confirmUnknownCountry: boolean) {
    if (!selected) return;
    assign.mutate(
      { tripId: selected.id, shipmentId: shipment.id, confirmUnknownCountry },
      {
        onSuccess: () => { toast.success(t('shipment_detail.parts.trip_linked')); onClose(); },
        onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
      },
    );
  }

  function handleOk() {
    if (!selected) return;
    if (selected.destination_country_code === null) {
      Modal.confirm({ title: t('truck_board.unknown_country_confirm'), onOk: () => submit(true) });
      return;
    }
    submit(false);
  }

  return (
    <Modal
      open
      title={t('shipment_detail.parts.choose_trip_title')}
      onCancel={onClose}
      onOk={handleOk}
      okText={t('truck_board.assign')}
      okButtonProps={{ disabled: selected === null }}
      confirmLoading={assign.isPending}
      destroyOnHidden
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : trips.length === 0 ? (
        <Empty description={t('shipment_detail.parts.no_free_trips')} />
      ) : (
        <Radio.Group value={selectedId} onChange={(e) => setSelectedId(Number(e.target.value))} style={{ width: '100%' }}>
          <List
            dataSource={trips}
            renderItem={(trip) => {
              const mismatch = tripCountryMismatch(trip.destination_country_code, shipment.country_code);
              return (
                <List.Item key={trip.id}>
                  <Radio value={trip.id} disabled={mismatch || !!trip.rejected_at} style={{ width: '100%' }}>
                    <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                      {trip.tractor_plate} / {trip.trailer_plate}
                    </Typography.Text>
                    <span style={{ marginLeft: 8, fontSize: 12 }}>
                      {trip.destination_country_code ?? '—'} · {trip.driver_full_name} · {fmt(trip.planned_departure)}
                    </span>
                    {mismatch && <Tag color="red" style={{ marginLeft: 8 }}>{t('truck_board.country_mismatch')}</Tag>}
                    {trip.rejected_at && (
                      <Tag color="red" style={{ marginLeft: 8 }}>
                        {t('truck_board.rejected_tag', { reason: trip.rejection_reason })}
                      </Tag>
                    )}
                  </Radio>
                </List.Item>
              );
            }}
          />
        </Radio.Group>
      )}
    </Modal>
  );
}
