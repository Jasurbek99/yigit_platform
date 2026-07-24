import type { ReactNode } from 'react';
import { Button } from 'antd';
import { IconDownload } from '@tabler/icons-react';
import { SERA } from '../seraTheme';

interface SeraPageHeaderProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  /** Banner background colour. Defaults to the Sera green. */
  readonly accent?: string;
  readonly accentDark?: string;
  /** Optional right-side extra (e.g. a "Jemi Yerine Yetiriş %" chip). */
  readonly extra?: ReactNode;
  readonly year?: number;
  readonly showPdf?: boolean;
}

/**
 * The coloured banner header used at the top of every Sera page — icon +
 * title + subtitle on the left, a year pill and "PDF Olarak Kaydet" button
 * on the right. Mirrors the source app's per-page gradient banners.
 */
export function SeraPageHeader({
  icon,
  title,
  subtitle,
  accent = SERA.green,
  accentDark = SERA.greenDark,
  extra,
  year = 2026,
  showPdf = true,
}: SeraPageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        padding: '18px 22px',
        borderRadius: 14,
        background: `linear-gradient(135deg, ${accent}, ${accentDark})`,
        color: '#fff',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {extra}
        <span
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.16)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {year}
        </span>
        {showPdf && (
          <Button icon={<IconDownload size={15} />} size="middle">
            PDF Olarak Kaydet
          </Button>
        )}
      </div>
    </div>
  );
}
