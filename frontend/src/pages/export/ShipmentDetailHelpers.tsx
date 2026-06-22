import { COLORS } from '@/constants/styles';
import { SalesReportPanel } from '@/components/SalesReportPanel';

// ─── InfoRow ────────────────────────────────────────────────────────────────

interface IInfoRowProps {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  mono?: boolean;
}

export function InfoRow({ label, value, bold, mono }: IInfoRowProps) {
  // Mirrors DetailFieldRow's row geometry (180px label, divider, shade) so
  // read-only InfoRows and editable DetailFieldRows line up when interleaved.
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid #f5f5f5',
      gap: 12,
    }}>
      <div style={{ flex: '0 0 180px', fontSize: 13, color: COLORS.textTertiary }}>{label}</div>
      <div style={{
        fontSize: 13,
        flex: 1,
        minWidth: 0,
        fontWeight: bold ? 600 : undefined,
        fontFamily: mono ? 'monospace' : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── SectionBlock ───────────────────────────────────────────────────────────

interface ISectionBlockProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function SectionBlock({ title, children, actions }: ISectionBlockProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontWeight: 600,
        fontSize: 14,
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <span>{title}</span>
        {actions && <span>{actions}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── SalesReportForm (re-exported for back-compat, now delegates to SalesReportPanel) ─

export { SalesReportPanel as SalesReportForm };
