import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useJoinBoard, useJoinShipments, useSwapPackaging, useUnjoinPackaging } from '@/hooks/useDrafts';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useAuth } from '@/hooks/useAuth';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { canUserJoin } from '@/components/sheet/joinHelpers';
import { COLORS } from '@/constants/styles';
import type { IShipmentDraft } from '@/types';
import { BoardColumn } from './assignment/BoardColumn';
import { SupplyCard } from './assignment/SupplyCard';
import { ExportPartCard } from './assignment/ExportPartCard';
import { PackingActionPanel } from './assignment/PackingActionPanel';
import { decideBoardAction, nextSelection, splitBoardColumns } from './assignment/boardHelpers';

const { Text, Title } = Typography;

/** Assignment board (spec 2026-09-29): join, detach and swap packing before loading. */
export default function AssignmentBoard() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const { data: rows = [], isLoading } = useJoinBoard();
  const joinMutation = useJoinShipments();
  const unjoinMutation = useUnjoinPackaging();
  const swapMutation = useSwapPackaging();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Deep link from the supply-plan pool: /export/assign?draftId=123 preselects it.
  useEffect(() => {
    const draftId = searchParams.get('draftId');
    if (draftId) setSelectedIds([Number(draftId)]);
  }, [searchParams]);

  const { free, waiting, joined } = splitBoardColumns(rows);
  const selected = selectedIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is IShipmentDraft => r !== undefined);
  const action = decideBoardAction(selected);
  const canAct = canUserJoin(user) && !isReadOnly;
  const isPending = joinMutation.isPending || unjoinMutation.isPending || swapMutation.isPending;

  const toggle = (id: number) => setSelectedIds((current) => nextSelection(current, id));
  const onError = (err: unknown) => toast.error(extractPatchError(err, t('packing.toast_error')));
  const done = () => setSelectedIds([]);

  function run() {
    if (action.kind === 'join') {
      joinMutation.mutate(
        { targetId: action.targetId, sourceId: action.sourceId },
        { onSuccess: () => { toast.success(t('packing.toast_joined')); done(); }, onError },
      );
    } else if (action.kind === 'unjoin') {
      unjoinMutation.mutate(action.id, {
        onSuccess: (res) => { toast.success(t('packing.toast_unjoined', { code: res.new_supply_code })); done(); },
        onError,
      });
    } else if (action.kind === 'swap') {
      swapMutation.mutate(
        { aId: action.aId, otherId: action.bId },
        { onSuccess: () => { toast.success(t('packing.toast_swapped')); done(); }, onError },
      );
    }
  }

  const groupHeader = (label: string, count: number) => (
    <div style={{ padding: '7px 14px', fontSize: 10, fontWeight: 600, color: COLORS.textSecondary,
      textTransform: 'uppercase', letterSpacing: '0.06em', background: COLORS.bgLayout,
      borderBottom: '1px solid #f0f0f0', margin: '8px -10px 6px' }}>
      {label} · {count}
    </div>
  );
  const empty = (key: string) => (
    <Text type="secondary" style={{ fontSize: 12, padding: 12, display: 'block', textAlign: 'center' }}>
      {t(key)}
    </Text>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('assign.page_title')}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{t('assign.page_subtitle')}</Text>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 14 }}>
          <BoardColumn title={t('assign.col_supply')} dotColor="#13c2c2" count={free.length}>
            {free.length === 0 ? empty('assign.supply_empty') : free.map((d) => (
              <SupplyCard key={d.id} draft={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
            ))}
          </BoardColumn>

          <BoardColumn title={t('assign.col_action')}>
            <PackingActionPanel
              selected={selected}
              action={action}
              canAct={canAct}
              isPending={isPending}
              onRun={run}
              onClear={done}
            />
            {isReadOnly && <Tag style={{ margin: 16 }}>{t('assign.read_only')}</Tag>}
          </BoardColumn>

          <BoardColumn title={t('assign.col_export')} dotColor="#d4380d" count={waiting.length + joined.length}>
            {waiting.length + joined.length === 0 ? empty('assign.export_empty') : (
              <>
                {groupHeader(t('assign.group_waiting'), waiting.length)}
                {waiting.map((d) => (
                  <ExportPartCard key={d.id} part={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
                ))}
                {groupHeader(t('assign.group_joined'), joined.length)}
                {joined.map((d) => (
                  <ExportPartCard key={d.id} part={d} selected={selectedIds.includes(d.id)} onSelect={() => toggle(d.id)} />
                ))}
              </>
            )}
          </BoardColumn>
        </div>
      )}
    </div>
  );
}
