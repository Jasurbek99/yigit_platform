import { useTranslation } from 'react-i18next';
import { Button, Card, Typography } from 'antd';
import { IconFileText, IconDownload } from '@tabler/icons-react';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IReportTile {
  icon: string;
  nameKey: string;
  section: string;
}

const REPORT_TILES: IReportTile[] = [
  { icon: '📅', nameKey: 'boss_dashboard.reports.monthly', section: 'monthly' },
  { icon: '🏢', nameKey: 'boss_dashboard.reports.by_firm', section: 'firms' },
  { icon: '🗺️', nameKey: 'boss_dashboard.reports.routes', section: 'routes' },
  { icon: '🏗️', nameKey: 'boss_dashboard.reports.blocks', section: 'blocks' },
  { icon: '📊', nameKey: 'boss_dashboard.reports.seasons_compare', section: 'seasons_compare' },
  { icon: '📋', nameKey: 'boss_dashboard.reports.audit', section: 'audit' },
];

function downloadFile(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function ReportsGrid() {
  const { t } = useTranslation();

  const handleExcel = (section: string) => {
    downloadFile(`/api/v1/export/boss/export_excel/?section=${section}`);
  };

  const handlePdf = (section: string) => {
    downloadFile(`/api/v1/export/boss/export_pdf/?section=${section}`);
  };

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.reports')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {REPORT_TILES.map((tile) => (
          <div
            key={tile.section}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              padding: '14px 16px',
              background: COLORS.bgLayout,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{tile.icon}</span>
              <Text style={{ fontSize: 13, fontWeight: 500 }}>{t(tile.nameKey)}</Text>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="small"
                icon={<IconFileText size={13} />}
                onClick={() => handleExcel(tile.section)}
                style={{ flex: 1 }}
              >
                {t('boss_dashboard.reports.excel')}
              </Button>
              <Button
                size="small"
                icon={<IconDownload size={13} />}
                onClick={() => handlePdf(tile.section)}
                style={{ flex: 1 }}
              >
                {t('boss_dashboard.reports.pdf')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
