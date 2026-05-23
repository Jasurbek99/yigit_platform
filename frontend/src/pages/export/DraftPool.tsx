import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Alert, Tag, Typography, Badge } from 'antd';
import { BarChartOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useDrafts } from '@/hooks/useDrafts';
import { DraftComposerModal } from '@/components/draft/DraftComposerModal';
import { ForecastEntryModal } from '@/components/draft/ForecastEntryModal';
import { FreshnessPill } from '@/components/FreshnessPill';
import type { IShipmentDraft } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

const FRESHNESS_BORDER: Record<'today' | 'yesterday' | 'aged', string> = {
  today: COLORS.success,
  yesterday: COLORS.warning,
  aged: COLORS.danger,
};

// ─── DraftCard ────────────────────────────────────────────────────────────

interface IDraftCardProps {
  draft: IShipmentDraft;
}

/** The stored Shipment Code is pipe-delimited "DD|MM|NNN|BLK|YY|VV" with a
 *  letter month (e.g. "MY"). Show the filled fields joined, never raw pipes. */
function formatShipmentCode(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split('|').filter((p) => p.trim() !== '');
  return parts.length > 0 ? parts.join('·') : null;
}

function DraftCard({ draft }: IDraftCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const freshness = draft.freshness;

  // Block codes only — weights live separately below, smaller.
  const blockCodesStr = draft.block_sources.map((s) => s.block_code).join(' · ');
  // Total from the block allocations (weight_net is null on fresh drafts).
  const totalWeight = draft.block_sources.reduce((s, b) => s + Number(b.weight_kg ?? 0), 0);
  // Prefer the Shipment Code (letter month, as typed); fall back to Export Code.
  const shipmentCode = formatShipmentCode(draft.official_export_code);

  function handleAssign(e: React.MouseEvent) {
    e.stopPropagation();
    navigate(`/export/assign?draftId=${draft.id}`);
  }

  function handleCardClick() {
    navigate(`/export/assign?draftId=${draft.id}`);
  }

  return (
    <div
      onClick={handleCardClick}
      style={{
        background: COLORS.white,
        border: `1px solid #d9d9d9`,
        borderLeft: `3px solid ${FRESHNESS_BORDER[freshness]}`,
        borderRadius: 8,
        padding: 14,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = COLORS.primary;
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 6px rgba(22,119,255,0.15)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = COLORS.borderLight;
        (e.currentTarget as HTMLDivElement).style.borderLeft = `3px solid ${FRESHNESS_BORDER[freshness]}`;
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Aged redirect hint banner */}
      {freshness === 'aged' && (
        <div
          style={{
            padding: '4px 8px',
            background: COLORS.bgRed,
            border: '1px solid #ffccc7',
            borderRadius: 4,
            fontSize: 11,
            color: '#cf1322',
            marginBottom: 8,
          }}
        >
          {t('freshness.aged_redirect_hint')}
        </div>
      )}

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div
            style={{
              fontFamily: FONT.mono,
              fontWeight: 600,
              fontSize: 14,
              color: COLORS.primary,
              letterSpacing: '0.02em',
            }}
          >
            {shipmentCode ?? draft.cargo_code}
          </div>
          {shipmentCode && (
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLORS.textSecondary, marginTop: 1 }}>
              {t('official_code.platform_id_label')}: {draft.cargo_code}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          <FreshnessPill freshness={freshness} ageDays={draft.harvest_age_days} size="small" />
          <Tag style={{ margin: 0 }}>
            {draft.block_sources.length} {t('draft.blocks_suffix')}
          </Tag>
        </div>
      </div>

      {/* Block codes — prominent; weight smaller, below */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, letterSpacing: '0.03em' }}>
          {blockCodesStr}
        </div>
        <div style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT.mono, marginTop: 2 }}>
          {totalWeight.toLocaleString('ru-RU')} kg
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Text type="secondary" style={{ fontSize: 11, fontFamily: FONT.mono }}>
          {draft.created_by_name} · {dayjs(draft.created_at).format('DD.MM HH:mm')}
        </Text>
        <Button size="small" type="primary" onClick={handleAssign}>
          {t('draft.card_assign_btn')} →
        </Button>
      </div>
    </div>
  );
}

// ─── DraftPool page ───────────────────────────────────────────────────────

export default function DraftPool() {
  const { t } = useTranslation();
  const [composerOpen, setComposerOpen] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const { data: drafts = [], isLoading, isError } = useDrafts();

  const totalWeight = drafts.reduce(
    (s, d) => s + d.block_sources.reduce((bs, b) => bs + Number(b.weight_kg ?? 0), 0),
    0,
  );

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
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('draft.page_title')}
            {drafts.length > 0 && (
              <Badge
                count={drafts.length}
                style={{ marginLeft: 10, background: COLORS.warning }}
              />
            )}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            {t('draft.page_subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<BarChartOutlined />}
            onClick={() => setForecastOpen(true)}
          >
            {t('draft.enter_forecast_btn')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setComposerOpen(true)}
          >
            {t('draft.create_draft_btn')}
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <Alert
        type="info"
        showIcon
        message={
          <span>
            <strong>{t('draft.banner_title')}</strong> {t('draft.banner_body')}
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      {/* Content */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}

      {isError && (
        <Alert type="error" message={t('draft.error_load')} showIcon />
      )}

      {!isLoading && !isError && (
        <>
          {/* Card list header */}
          <div
            style={{
              background: COLORS.white,
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '13px 18px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {drafts.length} {t('draft.card_list_title')}
                {totalWeight > 0 && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    — {(totalWeight / 1000).toFixed(1)}t {t('draft.total_suffix')}
                  </Text>
                )}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('draft.sorted_oldest_first')}
              </Text>
            </div>

            {drafts.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <Text type="secondary">{t('draft.empty')}</Text>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 12,
                  padding: 14,
                }}
              >
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <DraftComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
      />

      <ForecastEntryModal
        open={forecastOpen}
        onClose={() => setForecastOpen(false)}
      />
    </div>
  );
}
