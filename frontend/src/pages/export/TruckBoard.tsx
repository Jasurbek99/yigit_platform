import { useMemo, useState } from 'react';
import { Alert, Spin, Tabs, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { canDo } from '@/utils/permissions';
import {
  useAssignTrip, useCandidateShipments, useExternalTrips, useTripSyncState,
} from '@/hooks/useExternalTrips';
import { LinkedTripsTab } from './truckBoard/LinkedTripsTab';
import { RejectTripModal } from './truckBoard/RejectTripModal';
import { ShipmentNeedCard } from './truckBoard/ShipmentNeedCard';
import { TripCard } from './truckBoard/TripCard';
import { TripDrawer } from './truckBoard/TripDrawer';
import { TruckMatchPanel } from './truckBoard/TruckMatchPanel';
import {
  STALE_SYNC_MINUTES, apiErrorKey, confirmUnknownCountry, filterShipmentsForTrip, filterTripsForShipment,
  syncAgeMinutes,
} from './truckBoard/truckBoardHelpers';

const { Title, Text } = Typography;

export default function TruckBoard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const canAssign = canDo(user, 'shipment_assign', 'edit');
  const { data: shipments = [], isLoading: shipmentsLoading, isError: shipmentsError } = useCandidateShipments();
  const { data: trips = [], isLoading: tripsLoading, isError: tripsError } = useExternalTrips({ free: true });
  const { data: sync } = useTripSyncState();
  const assign = useAssignTrip();

  const [shipmentId, setShipmentId] = useState<number | null>(null);
  const [tripId, setTripId] = useState<number | null>(null);
  const [drawerTripId, setDrawerTripId] = useState<number | null>(null);
  const [rejectTripId, setRejectTripId] = useState<number | null>(null);

  const shipment = shipments.find((s) => s.id === shipmentId) ?? null;
  const trip = trips.find((tr) => tr.id === tripId) ?? null;
  const { matching, unknown } = useMemo(() => filterTripsForShipment(trips, shipment), [trips, shipment]);
  const visibleShipments = useMemo(() => filterShipmentsForTrip(shipments, trip), [shipments, trip]);
  const age = syncAgeMinutes(sync?.last_success_at ?? null);

  function doAssign(confirmUnknownCountry = false) {
    if (!shipment || !trip) return;
    assign.mutate(
      { tripId: trip.id, shipmentId: shipment.id, confirmUnknownCountry },
      {
        onSuccess: () => {
          toast.success(t('truck_board.assigned', { code: shipment.shipment_code }));
          setShipmentId(null);
          setTripId(null);
        },
        onError: (err) => toast.error(t(`truck_board.error.${apiErrorKey(err)}`)),
      },
    );
  }

  function handleAssign() {
    if (trip?.destination_country_code === null) {
      confirmUnknownCountry(t, () => doAssign(true));
      return;
    }
    doAssign();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4}>{t('truck_board.title')}</Title>
          <Text type="secondary">{t('truck_board.subtitle')}</Text>
        </div>
        <div>
          {sync?.is_mock && <Tag color="orange">{t('common.demo_badge')}</Tag>}
          <Text type={age !== null && age > STALE_SYNC_MINUTES ? 'warning' : 'secondary'} data-testid="sync-age">
            {age === null ? t('truck_board.never_synced') : t('truck_board.synced_ago', { minutes: age })}
          </Text>
        </div>
      </div>
      {sync?.last_error && <Alert type="warning" showIcon message={t('truck_board.sync_error')} style={{ margin: '8px 0' }} />}
      {(tripsError || shipmentsError) && (
        <Alert type="error" showIcon message={t('truck_board.load_error')} style={{ margin: '8px 0' }} />
      )}
      <Tabs
        items={[
          {
            key: 'join',
            label: t('truck_board.tab_join'),
            children: (
              <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 14, marginTop: 12 }}>
                <div>
                  <Text strong>{t('truck_board.col_shipments')} · {visibleShipments.length}</Text>
                  {shipmentsLoading ? <Spin /> : visibleShipments.map((s) => (
                    <ShipmentNeedCard key={s.id} shipment={s} selected={s.id === shipmentId}
                      onSelect={() => setShipmentId(s.id === shipmentId ? null : s.id)} />
                  ))}
                </div>
                <TruckMatchPanel shipment={shipment} trip={trip} canAssign={canAssign} isReadOnly={isReadOnly}
                  isLoading={assign.isPending} onAssign={handleAssign}
                  onClear={() => { setShipmentId(null); setTripId(null); }} />
                <div>
                  <Text strong>{t('truck_board.col_trips')} · {matching.length}</Text>
                  {tripsLoading ? <Spin /> : matching.map((tr) => (
                    <TripCard key={tr.id} trip={tr} selected={tr.id === tripId} countryCode={shipment?.country_code ?? null}
                      onSelect={() => setTripId(tr.id === tripId ? null : tr.id)} onOpen={() => setDrawerTripId(tr.id)} />
                  ))}
                  {unknown.length > 0 && <Text type="secondary">{t('truck_board.unknown_country_group')}</Text>}
                  {unknown.map((tr) => (
                    <TripCard key={tr.id} trip={tr} dimmed selected={tr.id === tripId} countryCode={shipment?.country_code ?? null}
                      onSelect={() => setTripId(tr.id === tripId ? null : tr.id)} onOpen={() => setDrawerTripId(tr.id)} />
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'linked',
            label: t('truck_board.tab_linked'),
            children: <LinkedTripsTab canEdit={canAssign && !isReadOnly} />,
          },
        ]}
      />
      <TripDrawer trip={trips.find((tr) => tr.id === drawerTripId) ?? null} canReject={canAssign && !isReadOnly}
        onReject={(tr) => { setDrawerTripId(null); setRejectTripId(tr.id); }} onClose={() => setDrawerTripId(null)} />
      <RejectTripModal trip={trips.find((tr) => tr.id === rejectTripId) ?? null} onClose={() => setRejectTripId(null)} />
    </div>
  );
}
