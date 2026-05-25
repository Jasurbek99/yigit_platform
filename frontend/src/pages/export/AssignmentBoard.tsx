import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Modal, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDrafts, useAssignDraft } from '@/hooks/useDrafts';
import { MOCK_DEMAND } from '@/mock/demand';
import { SupplyCard } from './assignment/SupplyCard';
import { DemandCard } from './assignment/DemandCard';
import { MatchPanel } from './assignment/MatchPanel';
import { getDemandGroups } from './assignment/assignmentHelpers';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;

export default function AssignmentBoard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: drafts = [], isLoading: draftsLoading } = useDrafts();
  const assignDraft = useAssignDraft();

  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [selectedDemandId, setSelectedDemandId] = useState<number | null>(null);

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

        {/* Center: match panel */}
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
            {demandGroups.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12, padding: 12, display: 'block', textAlign: 'center' }}>
                {t('assign.demand_empty')}
              </Text>
            ) : (
              demandGroups.map((group) => (
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
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
