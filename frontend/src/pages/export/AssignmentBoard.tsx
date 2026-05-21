import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useDrafts } from '@/hooks/useDrafts';
import { MOCK_DEMAND } from '@/mock/demand';
import { SupplyCard } from './assignment/SupplyCard';
import { DemandCard } from './assignment/DemandCard';
import { SplitTrucksPanel } from './assignment/SplitTrucksPanel';
import { getDemandGroups } from './assignment/assignmentHelpers';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;

export default function AssignmentBoard() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const { data: drafts = [], isLoading: draftsLoading } = useDrafts();

  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [selectedDemandId, setSelectedDemandId] = useState<number | null>(null);

  useEffect(() => {
    const draftIdParam = searchParams.get('draftId');
    if (draftIdParam) {
      setSelectedDraftId(Number(draftIdParam));
    }
  }, [searchParams]);

  const selectedDraft = drafts.find((d) => d.id === selectedDraftId) ?? null;

  const demandGroups = getDemandGroups(MOCK_DEMAND, t);

  function handleSplitClose() {
    setSelectedDraftId(null);
    setSelectedDemandId(null);
  }

  return (
    <div>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr 340px',
          gap: 14,
        }}
      >
        {/* Left: supply */}
        <div
          style={{
            background: COLORS.white,
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
                background: COLORS.border,
                padding: '2px 9px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textTertiary,
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

        {/* Center: split trucks panel */}
        <div
          style={{
            background: COLORS.white,
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 600,
            overflowY: 'auto',
          }}
        >
          {selectedDraft ? (
            <SplitTrucksPanel draft={selectedDraft} onClose={handleSplitClose} />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                color: COLORS.textSecondary,
                textAlign: 'center',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 28, opacity: 0.4 }}>&#9656;</div>
              <div style={{ fontSize: 13 }}>{t('assign.center_select_draft')}</div>
            </div>
          )}
        </div>

        {/* Right: demand */}
        <div
          style={{
            background: COLORS.white,
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
                background: COLORS.border,
                padding: '2px 9px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textTertiary,
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
                    color: COLORS.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    background: COLORS.bgLayout,
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
