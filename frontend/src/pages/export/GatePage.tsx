import { useState } from 'react';
import { Alert, Empty, Input, Segmented, Select, Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLoadingLocations } from '@/hooks/useAdmin';
import { gateErrorCode, useGateAction, useGateBoard } from '@/hooks/useGate';
import type { GateAction } from '@/hooks/useGate';
import { GateTruckCard } from '@/components/gate/GateTruckCard';
import { GateConfirmModal } from '@/components/gate/GateConfirmModal';
import { plateMatches } from '@/utils/plateSearch';
import { canDo } from '@/utils/permissions';
import type { IGateRow } from '@/types';

const { Title, Text } = Typography;

type GateTab = 'expected' | 'inside';

/**
 * The gate guard's screen (garawul). Built for a phone at the gate: one search
 * box, two tabs, one big button per truck, a confirm on every tap.
 * Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §2.1
 */
export default function GatePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isGuard = user?.role === 'garawul';
  // Computed once here and threaded down, per final-fix review F9 — a boss in
  // view mode or a role without the `gate` grant sees cards but no buttons.
  const canMark = canDo(user, 'gate', 'edit');
  const { data: locations = [] } = useLoadingLocations();
  const [pickedLocation, setPickedLocation] = useState<number | null>(null);
  const locationId = isGuard ? null : (pickedLocation ?? locations[0]?.id ?? null);
  const board = useGateBoard(locationId, isGuard || locationId !== null);
  const gateAction = useGateAction();
  const [tab, setTab] = useState<GateTab>('expected');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<{ row: IGateRow; action: GateAction } | null>(null);

  const matches = (row: IGateRow) => plateMatches(search, row.truck_plate, row.truck_plate_2);
  const expected = (board.data?.expected ?? []).filter(matches);
  const inside = (board.data?.inside ?? []).filter(matches);
  const recentlyLeft = (board.data?.recently_left ?? []).filter(matches);

  function handleConfirm() {
    if (!pending) return;
    const { row, action } = pending;
    gateAction.mutate(
      { id: row.id, action, locationId },
      {
        onSuccess: () => toast.success(t(`gate.done_${action.startsWith('undo') ? 'undo' : action}`)),
        onError: (error) => {
          const code = gateErrorCode(error);
          // The global axios interceptor already toasts season_closed
          // (services/api.ts) — skip the second toast here (final-fix F13).
          if (code === 'season_closed') return;
          toast.error(t(`gate.error.${code ?? 'generic'}`, { defaultValue: t('gate.error.generic') }));
        },
        onSettled: () => setPending(null),
      },
    );
  }

  const onAction = (row: IGateRow, action: GateAction) => setPending({ row, action });

  // Full-page Alert only when there is nothing to show at all. Once the
  // first load succeeds, a later poll failure must not blank the list a
  // guard is actively using — show a small inline warning instead
  // (final-fix review F11).
  if (board.isError && !board.data) {
    const code = gateErrorCode(board.error);
    return (
      <Alert
        type={code === 'no_location' ? 'warning' : 'error'}
        showIcon
        style={{ margin: 16 }}
        message={code === 'no_location' ? t('gate.no_location') : t('gate.error.generic')}
      />
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 4px' }}>
      <Title level={4} style={{ marginBottom: 8 }}>
        {t('gate.title', { location: board.data?.location.name ?? '' })}
      </Title>
      {board.isError && board.data && (
        <Alert type="warning" showIcon banner message={t('gate.stale')} style={{ marginBottom: 8 }} />
      )}
      {!isGuard && (
        <Select
          value={locationId ?? undefined}
          onChange={setPickedLocation}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
          placeholder={t('gate.location')}
          style={{ width: '100%', marginBottom: 8 }}
          size="large"
        />
      )}
      <Input.Search
        allowClear
        size="large"
        placeholder={t('gate.search_placeholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Segmented
        block
        size="large"
        value={tab}
        onChange={(value) => setTab(value as GateTab)}
        options={[
          { value: 'expected', label: t('gate.tab_expected', { count: expected.length }) },
          { value: 'inside', label: t('gate.tab_inside', { count: inside.length }) },
        ]}
        style={{ marginBottom: 12 }}
      />
      {board.isLoading ? (
        <Skeleton active />
      ) : tab === 'expected' ? (
        expected.length === 0 ? (
          <Empty description={t('gate.empty_expected')} />
        ) : (
          expected.map((row) => (
            <GateTruckCard
              key={row.id} row={row} primaryAction={canMark ? 'arrive' : undefined} onAction={onAction}
            />
          ))
        )
      ) : (
        <>
          {inside.length === 0 && <Empty description={t('gate.empty_inside')} />}
          {inside.map((row) => (
            <GateTruckCard
              key={row.id} row={row}
              primaryAction={canMark ? 'depart' : undefined}
              undoAction={canMark ? 'undo_arrive' : undefined}
              onAction={onAction}
            />
          ))}
          {recentlyLeft.length > 0 && (
            <>
              <Text type="secondary" style={{ display: 'block', margin: '16px 0 8px' }}>
                {t('gate.recently_left')}
              </Text>
              {recentlyLeft.map((row) => (
                <GateTruckCard
                  key={row.id} row={row}
                  undoAction={canMark ? 'undo_depart' : undefined}
                  muted onAction={onAction}
                />
              ))}
            </>
          )}
        </>
      )}
      <GateConfirmModal
        pending={pending ? { plate: pending.row.truck_plate ?? pending.row.shipment_code, action: pending.action } : null}
        loading={gateAction.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
