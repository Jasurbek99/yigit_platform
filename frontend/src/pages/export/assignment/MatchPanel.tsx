import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { IShipmentDraft, IDemandItem } from '@/types';

const { Text } = Typography;

interface IMatchPanelProps {
  draft: IShipmentDraft | null;
  demand: IDemandItem | null;
  onConfirm: () => void;
  onClear: () => void;
  isLoading: boolean;
}

export function MatchPanel({ draft, demand, onConfirm, onClear, isLoading }: IMatchPanelProps) {
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

  const freshness = draft ? draft.freshness : null;
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

    if (freshness === 'aged') {
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

    if (draft.variety_confidence === 'none' && demand.strict) {
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
            🔒 <strong>{t('assign.variety_pending_warning_title')}</strong>{' '}
            {t('assign.variety_pending_warning_body')}
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
