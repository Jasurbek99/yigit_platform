import type { ReactNode } from 'react';
import { SERA } from '../seraTheme';

export interface MatrixRow {
  readonly label: ReactNode;
  readonly cells: readonly ReactNode[];
  readonly bold?: boolean;
  readonly indent?: boolean;
  /** Render as a group sub-header spanning all columns. */
  readonly groupHeader?: boolean;
  readonly labelColor?: string;
}

interface SeraMatrixTableProps {
  readonly headers: readonly string[]; // includes the first (label) column header
  readonly rows: readonly MatrixRow[];
  /** Optional footer row (e.g. "Toplam"). */
  readonly footer?: MatrixRow;
  /** Right-align numeric cells (default true). */
  readonly numeric?: boolean;
  readonly minWidth?: number;
}

/**
 * A horizontally-scrollable comparison table: a sticky-ish first label column
 * plus N numeric columns, optional group sub-headers, and a highlighted footer
 * totals row. Shared across the Bütçe / Satış / Dashboard screens.
 */
export function SeraMatrixTable({ headers, rows, footer, numeric = true, minWidth = 720 }: SeraMatrixTableProps) {
  const align = (i: number) => (i === 0 || !numeric ? 'left' : 'right');

  const renderRow = (r: MatrixRow, key: string | number, footerRow = false) => {
    if (r.groupHeader) {
      return (
        <tr key={key}>
          <td
            colSpan={headers.length}
            style={{ padding: '8px 12px', background: SERA.greenSoft, fontWeight: 700, color: SERA.green, fontSize: 13 }}
          >
            {r.label}
          </td>
        </tr>
      );
    }
    return (
      <tr key={key} style={footerRow ? { background: SERA.slate, color: '#fff' } : undefined}>
        <td
          style={{
            padding: '8px 12px',
            textAlign: 'left',
            paddingLeft: r.indent ? 26 : 12,
            fontWeight: r.bold || footerRow ? 700 : 500,
            color: footerRow ? '#fff' : r.labelColor ?? SERA.ink,
            borderBottom: footerRow ? 'none' : `1px solid ${SERA.line}`,
            whiteSpace: 'nowrap',
          }}
        >
          {r.label}
        </td>
        {r.cells.map((c, i) => (
          <td
            key={i}
            style={{
              padding: '8px 12px',
              textAlign: align(i + 1),
              fontWeight: r.bold || footerRow ? 700 : 400,
              color: footerRow ? '#fff' : SERA.ink,
              borderBottom: footerRow ? 'none' : `1px solid ${SERA.line}`,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {c}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: '8px 12px',
                  textAlign: align(i),
                  color: SERA.sub,
                  fontWeight: 600,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `2px solid ${SERA.line}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map((r, i) => renderRow(r, i))}</tbody>
        {footer && <tfoot>{renderRow(footer, 'footer', true)}</tfoot>}
      </table>
    </div>
  );
}
