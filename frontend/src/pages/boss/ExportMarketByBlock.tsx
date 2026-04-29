import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossExportMarketRow } from '@/hooks/useBossDashboard';
import { useBossExportMarket } from '@/hooks/useBossDashboard';

// CRITICAL: This component intentionally shows ONLY Daşarky Bazar (export market).
// Içerki Bazar (domestic) and Sowgatlyk (gift) are explicitly excluded from v1.
// Do not add columns, fields, or keys for domestic or gift data here.

const { Text } = Typography;

interface IExportMarketByBlockProps {
  period: BossPeriod;
}

export function ExportMarketByBlock({ period }: IExportMarketByBlockProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossExportMarket(period);

  const rows = data?.rows ?? [];
  const totalKg = rows.reduce((sum, row) => sum + (row.export_kg ?? 0), 0);

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.export_market')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 1fr 2.5fr',
                padding: '7px 14px',
                background: '#fafafa',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: 600, color: '#595959' }}>
                {t('boss_dashboard.export_market.header_block')}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: 600, color: '#595959', textAlign: 'right' }}>
                {t('boss_dashboard.export_market.header_kg')}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: 600, color: '#595959', textAlign: 'right' }}>
                {t('boss_dashboard.export_market.header_pct')}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: 600, color: '#595959', paddingLeft: 12 }}>
                {/* Share bar — no label */}
              </Text>
            </div>

            {/* Data rows */}
            {rows.map((row: IBossExportMarketRow) => (
              <div
                key={row.block_code}
                onClick={() => navigate(`/export/shipments?block_source=${row.block_code}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.5fr 1fr 2.5fr',
                  padding: '6px 14px',
                  borderBottom: '1px solid #f5f5f5',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <Text style={{ fontSize: 12 }}>{row.block_code}</Text>
                <Text style={{ fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                  {row.export_kg.toLocaleString()}
                </Text>
                <Text style={{ fontSize: 12, textAlign: 'right', color: '#1677ff' }}>
                  {row.export_pct.toFixed(1)}%
                </Text>
                <div style={{ paddingLeft: 12, display: 'flex', alignItems: 'center' }}>
                  <ExportShareBar exportPct={row.export_pct} />
                </div>
              </div>
            ))}

            {/* Total row */}
            {rows.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.5fr 1fr 2.5fr',
                  padding: '7px 14px',
                  background: '#f5f5f5',
                  borderTop: '1px solid #e8e8e8',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('boss_dashboard.export_market.total_row')}</Text>
                <Text style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' }}>
                  {totalKg.toLocaleString()}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>100%</Text>
                <div />
              </div>
            )}

            {rows.length === 0 && (
              <div style={{ padding: '12px 14px' }}>
                <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.no_data')}</Text>
              </div>
            )}
          </div>

          {/* Footer note */}
          <div style={{ marginTop: 8 }}>
            <Text
              type="secondary"
              style={{ fontSize: 11, fontStyle: 'italic' }}
            >
              {t('boss_dashboard.export_market.note_excluded')}
            </Text>
          </div>
        </>
      )}
    </Card>
  );
}

function ExportShareBar({ exportPct }: { exportPct: number }) {
  // Shows only the export segment — the remainder is shown as empty (unallocated in v1)
  return (
    <div style={{ display: 'flex', width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f0f0f0', gap: 1 }}>
      <div
        style={{
          width: `${Math.min(exportPct, 100)}%`,
          background: '#1677ff',
          transition: 'width 0.3s',
        }}
      />
    </div>
  );
}
