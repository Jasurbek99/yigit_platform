import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Alert, Spin, Tag, Typography, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useDrafts, useAssignDraft } from '@/hooks/useDrafts';
import { MOCK_DEMAND } from '@/mock/demand';
import { getFreshness, type Freshness } from '@/utils/freshness';
import type { IShipmentDraft, IDemandItem } from '@/types';

const { Text, Title } = Typography;

// ─── Helpers ──────────────────────────────────────────────────────────────

const FRESHNESS_ICON: Record<Freshness, string> = {
  today: '🟢',
  yesterday: '🟡',
  old: '🔴',
};

const FRESHNESS_BORDER: Record<Freshness, string> = {
  today: '#52c41a',
  yesterday: '#faad14',
  old: '#ff4d4f',
};

function getDemandGroups(
  items: IDemandItem[],
  t: (key: string) => string,
): { label: string; items: IDemandItem[] }[] {
  return [
    { label: t('assign.group_contracts'), items: items.filter((d) => d.type === 'contract') },
    { label: t('assign.group_quota'), items: items.filter((d) => d.type === 'quota') },
    { label: t('assign.group_queue'), items: items.filter((d) => d.type === 'queue') },
  ].filter((g) => g.items.length > 0);
}

// ─── SupplyCard (left column) ─────────────────────────────────────────────

interface ISupplyCardProps {
  draft: IShipmentDraft;
  selected: boolean;
  onSelect: () => void;
}

function SupplyCard({ draft, selected, onSelect }: ISupplyCardProps) {
  const { t } = useTranslation();
  const freshness = getFreshness(draft.created_at);
  const sourceCodes = draft.block_sources.map((s) => s.block_code).join(' + ');
  const ageLabel =
    freshness === 'today'
      ? t('assign.age_today_with_hours', {
          hours: dayjs().diff(dayjs(draft.created_at), 'hour'),
        })
      : freshness === 'yesterday'
      ? t('assign.age_yesterday')
      : t('assign.age_old');

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? '#e6f4ff' : '#e6fffb',
        border: selected
          ? '2px solid #1677ff'
          : `1px solid #87e8de`,
        borderLeft: `3px solid ${FRESHNESS_BORDER[freshness]}`,
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: '#1677ff' }}>
          {draft.cargo_code}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#08979c' }}>
          {(draft.weight_net ?? 0).toLocaleString('ru-RU')} kg
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, marginTop: 3 }}>
        {FRESHNESS_ICON[freshness]} {sourceCodes}
      </div>
      <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2, fontStyle: 'italic' }}>
        {ageLabel}
      </div>
    </div>
  );
}

// ─── DemandCard (right column) ────────────────────────────────────────────

interface IDemandCardProps {
  item: IDemandItem;
  selected: boolean;
  onSelect: () => void;
}

function DemandCard({ item, selected, onSelect }: IDemandCardProps) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? '#e6f4ff' : '#fff2e8',
        border: selected ? '2px solid #1677ff' : '1px solid #ffbb96',
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          color: '#d4380d',
          letterSpacing: '0.06em',
          marginBottom: 3,
        }}
      >
        {item.country}
        {item.strict && <span style={{ marginLeft: 6 }}>🔒 {t('assign.label_strict')}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{item.customer}</div>
      <div style={{ fontSize: 11, color: '#595959', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>
          {t('assign.label_firm')}<strong>{item.firm}</strong>
        </div>
        <div>
          {t('assign.label_remaining')}<strong style={{ fontFamily: 'monospace' }}>{item.remaining}</strong>
          {item.due_days > 0 && ` · ${t('assign.label_days_suffix', { days: item.due_days })}`}
        </div>
        <div>
          {t('assign.label_pref')}<em>{item.pref}</em>
        </div>
      </div>
    </div>
  );
}

// ─── MatchPanel (center column) ───────────────────────────────────────────

interface IMatchPanelProps {
  draft: IShipmentDraft | null;
  demand: IDemandItem | null;
  onConfirm: () => void;
  onClear: () => void;
  isLoading: boolean;
}

function MatchPanel({ draft, demand, onConfirm, onClear, isLoading }: IMatchPanelProps) {
  const { t } = useTranslation();

  if (!draft && !demand) {
    return (
      <div
        style={{
          background: '#fafafa',
          border: '2px dashed #d9d9d9',
          borderRadius: 8,
          padding: 18,
          textAlign: 'center',
          color: '#8c8c8c',
          margin: 12,
          minHeight: 180,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.4 }}>⇄</div>
        <div>{t('assign.match_empty_primary')}</div>
        <div style={{ fontSize: 11 }}>{t('assign.match_empty_secondary')}</div>
      </div>
    );
  }

  // Compatibility logic
  const freshness = draft ? getFreshness(draft.created_at) : null;
  const sourceCodes = draft ? draft.block_sources.map((s) => s.block_code).join(' + ') : '';
  const ageLabel = draft
    ? freshness === 'today'
      ? t('assign.age_today_with_hours', {
          hours: dayjs().diff(dayjs(draft.created_at), 'hour'),
        })
      : freshness === 'yesterday'
      ? t('assign.age_yesterday')
      : t('assign.age_old')
    : '';

  let compatNode: React.ReactNode = null;
  if (draft && demand) {
    if (demand.pref === 'Islendik') {
      compatNode = (
        <div
          style={{
            padding: '8px 11px',
            background: '#f6ffed',
            borderRadius: 6,
            fontSize: 11,
            color: '#389e0d',
            border: '1px solid #b7eb8f',
            marginTop: 8,
          }}
        >
          ✓ <strong>{t('assign.compat_any_variety')}</strong>
        </div>
      );
    } else if (demand.strict) {
      compatNode = (
        <div
          style={{
            padding: '8px 11px',
            background: '#fffbe6',
            borderRadius: 6,
            fontSize: 11,
            color: '#d48806',
            border: '1px solid #ffe58f',
            marginTop: 8,
          }}
        >
          🔒 <strong>{t('assign.compat_strict_label')}:</strong> {demand.pref}.{' '}
          {t('assign.compat_strict_body')}
        </div>
      );
    } else {
      compatNode = (
        <div
          style={{
            padding: '8px 11px',
            background: '#f6ffed',
            borderRadius: 6,
            fontSize: 11,
            color: '#389e0d',
            border: '1px solid #b7eb8f',
            marginTop: 8,
          }}
        >
          ✓ {t('assign.compat_soft', { blocks: sourceCodes })}
        </div>
      );
    }

    if (freshness === 'old') {
      compatNode = (
        <>
          {compatNode}
          <div
            style={{
              padding: '8px 11px',
              background: '#fffbe6',
              borderRadius: 6,
              fontSize: 11,
              color: '#d48806',
              border: '1px solid #ffe58f',
              marginTop: 6,
            }}
          >
            🔴 <strong>{t('assign.compat_old_title')}</strong> {t('assign.compat_old_body')}
          </div>
        </>
      );
    } else if (freshness === 'yesterday') {
      compatNode = (
        <>
          {compatNode}
          <div
            style={{
              padding: '8px 11px',
              background: '#fffbe6',
              borderRadius: 6,
              fontSize: 11,
              color: '#d48806',
              border: '1px solid #ffe58f',
              marginTop: 6,
            }}
          >
            🟡 <strong>{t('assign.compat_yesterday_title')}</strong>{' '}
            {t('assign.compat_yesterday_body')}
          </div>
        </>
      );
    }
  }

  return (
    <div
      style={{
        background: '#f0f5ff',
        border: '2px solid #1677ff',
        borderRadius: 8,
        padding: 14,
        margin: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        {t('assign.match_title')}
      </div>

      {/* Supply row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '9px 10px',
          background: '#fff',
          borderRadius: 6,
          border: '1px solid #f0f0f0',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: '#8c8c8c',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontWeight: 600,
            minWidth: 60,
            flexShrink: 0,
          }}
        >
          {t('assign.match_supply')}
        </div>
        {draft ? (
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 500, color: '#1677ff' }}>
              {draft.cargo_code}
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>
              {sourceCodes} · {(draft.weight_net ?? 0).toLocaleString('ru-RU')} kg · {ageLabel}
            </div>
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('assign.not_selected')}
          </Text>
        )}
      </div>

      {/* Demand row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '9px 10px',
          background: '#fff',
          borderRadius: 6,
          border: '1px solid #f0f0f0',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: '#8c8c8c',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontWeight: 600,
            minWidth: 60,
            flexShrink: 0,
          }}
        >
          {t('assign.match_demand')}
        </div>
        {demand ? (
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 500, color: '#1677ff' }}>
              {demand.country}
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>
              {demand.customer} · {demand.firm}
            </div>
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('assign.not_selected')}
          </Text>
        )}
      </div>

      {compatNode}

      {/* Action buttons */}
      {draft && demand ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <Button style={{ flex: 1 }} onClick={onClear}>
            {t('assign.btn_clear')}
          </Button>
          <Button type="primary" style={{ flex: 2 }} loading={isLoading} onClick={onConfirm}>
            {t('assign.btn_confirm')}
          </Button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 8, textAlign: 'center' }}>
          {t('assign.match_both_required')}
        </div>
      )}
    </div>
  );
}

// ─── AssignmentBoard page ─────────────────────────────────────────────────

export default function AssignmentBoard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: drafts = [], isLoading: draftsLoading } = useDrafts();
  const assignDraft = useAssignDraft();

  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [selectedDemandId, setSelectedDemandId] = useState<number | null>(null);

  // Auto-select draft from URL param on mount
  useEffect(() => {
    const draftIdParam = searchParams.get('draftId');
    if (draftIdParam) {
      setSelectedDraftId(Number(draftIdParam));
    }
  }, [searchParams]);

  const selectedDraft = drafts.find((d) => d.id === selectedDraftId) ?? null;
  const selectedDemand = MOCK_DEMAND.find((d) => d.id === selectedDemandId) ?? null;

  const demandGroups = getDemandGroups(MOCK_DEMAND, t);

  function handleConfirm() {
    if (!selectedDraft || !selectedDemand) return;

    // MOCK_DEMAND does not yet carry real country/customer IDs (mock data only).
    // Send null for fields we can't resolve — backend accepts null (destination
    // is optional at assign-time; it can be edited later). Once demand is wired
    // to real contract/quota endpoints, selectedDemand.country_id / customer_id
    // should be used here.
    assignDraft.mutate(
      {
        draftId: selectedDraft.id,
        payload: {
          country: null,
          city: null,
          customer: null,
          import_firm: null,
        },
      },
      {
        onSuccess: (result) => {
          toast.success(
            t('assign.toast_confirmed', {
              code: selectedDraft.cargo_code,
              country: selectedDemand.country,
            }),
          );
          Modal.confirm({
            title: t('assign.confirm_navigate_title'),
            content: t('assign.confirm_navigate_body'),
            okText: t('assign.confirm_navigate_ok'),
            cancelText: t('assign.confirm_navigate_cancel'),
            onOk: () => navigate(`/shipments/${result.id}`),
          });
          setSelectedDraftId(null);
          setSelectedDemandId(null);
        },
        onError: () => toast.error(t('assign.toast_error')),
      },
    );
  }

  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {t('assign.page_title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('assign.page_subtitle')}
          </Text>
        </div>
        <Tag color="blue">{t('assign.role_label')}</Tag>
      </div>

      <Alert
        type="warning"
        showIcon
        message={
          <span>
            <strong>{t('assign.banner_title')}</strong> {t('assign.banner_body')}
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 3-column board */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr 340px',
          gap: 14,
        }}
      >
        {/* ── Left: supply ───────────────────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 600,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#13c2c2', display: 'inline-block' }} />
              {t('assign.col_supply')}
            </div>
            <div
              style={{
                background: '#f0f0f0',
                padding: '2px 9px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                color: '#595959',
              }}
            >
              {drafts.length}
            </div>
          </div>

          <div style={{ padding: 10, flex: 1, overflowY: 'auto', maxHeight: 680 }}>
            {draftsLoading ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : drafts.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12, padding: 12, display: 'block', textAlign: 'center' }}>
                {t('assign.supply_empty')}
              </Text>
            ) : (
              drafts.map((d) => (
                <SupplyCard
                  key={d.id}
                  draft={d}
                  selected={d.id === selectedDraftId}
                  onSelect={() =>
                    setSelectedDraftId(d.id === selectedDraftId ? null : d.id)
                  }
                />
              ))
            )}
          </div>
        </div>

        {/* ── Center: match panel ─────────────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 600,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t('assign.col_match')}</div>
          </div>
          <MatchPanel
            draft={selectedDraft}
            demand={selectedDemand}
            onConfirm={handleConfirm}
            onClear={() => {
              setSelectedDraftId(null);
              setSelectedDemandId(null);
            }}
            isLoading={assignDraft.isPending}
          />
        </div>

        {/* ── Right: demand ───────────────────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 600,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d4380d', display: 'inline-block' }} />
              {t('assign.col_demand')}
            </div>
            <div
              style={{
                background: '#f0f0f0',
                padding: '2px 9px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                color: '#595959',
              }}
            >
              {MOCK_DEMAND.length}
            </div>
          </div>

          <div style={{ padding: 10, flex: 1, overflowY: 'auto', maxHeight: 680 }}>
            {demandGroups.map((group) => (
              <div key={group.label}>
                <div
                  style={{
                    padding: '7px 14px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#8c8c8c',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    background: '#fafafa',
                    borderBottom: '1px solid #f0f0f0',
                    margin: '8px -10px 6px',
                  }}
                >
                  {group.label} · {group.items.length}
                </div>
                {group.items.map((item) => (
                  <DemandCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedDemandId}
                    onSelect={() =>
                      setSelectedDemandId(item.id === selectedDemandId ? null : item.id)
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
