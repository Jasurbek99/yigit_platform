import { SERA } from '../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../mock/seraData';

// ─── Generic chip ────────────────────────────────────────────────────────
interface ChipProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}
function Chip({ label, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 8,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : SERA.card,
        color: active ? '#fff' : SERA.ink,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.12s ease',
      }}
    >
      {active && '✓ '}
      {label}
    </button>
  );
}

function TinyBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 8,
        border: `1px solid ${SERA.line}`,
        background: SERA.greenSoft,
        color: SERA.green,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ─── Block selector ──────────────────────────────────────────────────────
interface BlockSelectorProps {
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly title?: string;
}

/** Grouped Dusak / Kaka / Owadandepe block-chip selector. */
export function SeraBlockSelector({ selected, onChange, title = 'Blok Saýlawy' }: BlockSelectorProps) {
  const allIds = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => b.id));
  const set = new Set(selected);

  const toggle = (id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  };
  const toggleGroup = (ids: string[]) => {
    const allOn = ids.every((id) => set.has(id));
    const next = new Set(set);
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    onChange([...next]);
  };

  return (
    <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: SERA.ink }}>{title}</span>
        <TinyBtn label="Hemmesini Saýla" onClick={() => onChange([...allIds])} />
        <TinyBtn label="Arassala" onClick={() => onChange([])} />
      </div>
      {SERA_BLOCKS_BY_GROUP.map((g) => {
        const ids = g.blocks.map((b) => b.id);
        return (
          <div key={g.group} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: SERA.sub, marginBottom: 6 }}>
              {g.group}{' '}
              <button
                type="button"
                onClick={() => toggleGroup(ids)}
                style={{ border: 'none', background: 'none', color: SERA.green, fontSize: 12, cursor: 'pointer' }}
              >
                (hemmesini saýla/aýyr)
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {g.blocks.map((b) => (
                <Chip key={b.id} label={b.name} active={set.has(b.id)} onClick={() => toggle(b.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Month selector ──────────────────────────────────────────────────────
interface MonthSelectorProps {
  readonly selected: readonly number[]; // 0-based month indexes
  readonly onChange: (months: number[]) => void;
  readonly title?: string;
}

/** Multi-select month chips (Ocak … Aralık) with all/clear shortcuts. */
export function SeraMonthSelector({ selected, onChange, title = 'Aý Saýlawy (birleşdirilip bilner)' }: MonthSelectorProps) {
  const set = new Set(selected);
  const toggle = (m: number) => {
    const next = new Set(set);
    next.has(m) ? next.delete(m) : next.add(m);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontWeight: 700, color: SERA.ink, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <TinyBtn label="Tüm Ýyl" onClick={() => onChange(MONTHS_TR.map((_, i) => i))} />
        <TinyBtn label="Arassala" onClick={() => onChange([])} />
        {MONTHS_TR.map((m, i) => (
          <Chip key={m} label={m} active={set.has(i)} onClick={() => toggle(i)} />
        ))}
      </div>
    </div>
  );
}
