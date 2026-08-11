import { useTranslation } from 'react-i18next';
import { Card, Typography } from 'antd';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IProcessGuide {
  icon: string;
  slug: string;
  nameKey: string;
  descKey: string;
}

const PROCESS_GUIDES: IProcessGuide[] = [
  { icon: '🗺️', slug: 'shipment-process-boss', nameKey: 'boss_dashboard.process.journey', descKey: 'boss_dashboard.process.journey_desc' },
  { icon: '🔀', slug: 'shipment-bpmn', nameKey: 'boss_dashboard.process.bpmn', descKey: 'boss_dashboard.process.bpmn_desc' },
];

function openProcessDoc(slug: string): void {
  window.open(`/api/v1/export/boss/process-doc/?doc=${slug}`, '_blank', 'noopener,noreferrer');
}

export function ProcessGuides() {
  const { t } = useTranslation();

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.process_guides')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {PROCESS_GUIDES.map((guide) => (
          <button
            key={guide.slug}
            type="button"
            onClick={() => openProcessDoc(guide.slug)}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              padding: '14px 16px',
              background: COLORS.bgLayout,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              font: 'inherit',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#f0f0f0';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{guide.icon}</span>
              <Text style={{ fontSize: 13, fontWeight: 500 }}>{t(guide.nameKey)}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>{t(guide.descKey)}</Text>
          </button>
        ))}
      </div>
    </Card>
  );
}
