import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossBlock } from '@/hooks/useBossDashboard';
import { useBossBlocksHeatmap } from '@/hooks/useBossDashboard';

const { Text } = Typography;

const BAND_COLORS: Record<IBossBlock['color_band'], { bg: string; text: string }> = {
  excellent: { bg: '#135200', text: '#fff' },
  good: { bg: '#52c41a', text: '#fff' },
  ok: { bg: '#95de64', text: '#135200' },
  warn: { bg: '#fa8c16', text: '#fff' },
  alert: { bg: '#ff4d4f', text: '#fff' },
};

interface IBlocksHeatmapProps {
  period: BossPeriod;
}

export function BlocksHeatmap({ period }: IBlocksHeatmapProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossBlocksHeatmap(period);

  const blocks = data?.rows ?? [];

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.blocks')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div
          role="group"
          aria-label={t('boss_dashboard.heatmap_aria')}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
            gap: 6,
          }}
        >
          {blocks.map((block) => {
            const colors = BAND_COLORS[block.color_band];
            const planLabel = block.plan_kg > 0
              ? `${((block.actual_kg / block.plan_kg) * 100).toFixed(0)}%`
              : '—';
            const navigateToBlock = () => navigate(`/export/plan?block=${block.block_code}`);
            const ariaLabel = t('boss_dashboard.heatmap_tile_aria', {
              block: block.block_name,
              actual: block.actual_kg.toLocaleString(),
              plan: block.plan_kg.toLocaleString(),
              pct: block.pct.toFixed(1),
              band: t(`boss_dashboard.band_${block.color_band}`),
            });
            return (
              <Tooltip
                key={block.block_code}
                title={`${block.block_name}: ${block.actual_kg.toLocaleString()} / ${block.plan_kg.toLocaleString()} kg (${block.pct.toFixed(1)}%)`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={ariaLabel}
                  onClick={navigateToBlock}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigateToBlock();
                    }
                  }}
                  style={{
                    background: colors.bg,
                    borderRadius: 6,
                    padding: '10px 6px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.85'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                >
                  <div aria-hidden="true" style={{ fontSize: 11, color: colors.text, fontWeight: 600 }}>
                    {block.block_code}
                  </div>
                  <div aria-hidden="true" style={{ fontSize: 14, fontWeight: 700, color: colors.text, lineHeight: 1.2 }}>
                    {planLabel}
                  </div>
                  <div aria-hidden="true" style={{ fontSize: 10, color: colors.text, opacity: 0.8, marginTop: 2 }}>
                    {(block.actual_kg / 1000).toFixed(1)}t
                  </div>
                </div>
              </Tooltip>
            );
          })}
          {blocks.length === 0 && (
            <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.no_data')}</Text>
          )}
        </div>
      )}
    </Card>
  );
}
