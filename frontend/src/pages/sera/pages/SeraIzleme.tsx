import { useState } from 'react';
import { Progress, Select } from 'antd';
import {
  IconLeaf, IconMessageCircle2, IconChevronDown, IconSeeding, IconMap2,
  IconClock, IconAlertTriangle, IconTemperature, IconPencil, IconSettings,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SERA, fmtPct } from '../seraTheme';
import { SERA_BLOCKS, SERA_BLOCKS_BY_GROUP } from '../mock/seraData';
import {
  BLOCK_READINESS, GROUP_OVERVIEW, IZLEME_BLOCK_CARDS, IZLEME_SEASONS,
  IZLEME_DEFAULT_SELECTED, type BlockProgressCard as BlockProgressCardData,
} from '../mock/izleme';

const MAIN_TABS = [
  { key: 'ekis', label: 'Ekiş Taýýarlygy', icon: <IconSeeding size={15} /> },
  { key: 'harita', label: 'Sera Kartasy', icon: <IconMap2 size={15} /> },
  { key: 'ýazgy', label: 'Ýazgylar', icon: <IconClock size={15} /> },
  { key: 'kesel', label: 'Kesel', icon: <IconAlertTriangle size={15} /> },
  { key: 'howa', label: 'Howa & Yşyk', icon: <IconTemperature size={15} /> },
] as const;
type MainTabKey = (typeof MAIN_TABS)[number]['key'];

interface SubTab {
  readonly key: 'umumy' | 'girizme' | 'sazlama';
  readonly label: string;
  readonly icon?: React.ReactNode;
}
const SUB_TABS: readonly SubTab[] = [
  { key: 'umumy', label: 'Umumy görnüş' },
  { key: 'girizme', label: 'Girizme' },
  { key: 'sazlama', label: 'Iş sazlamalary', icon: <IconSettings size={13} /> },
];
type SubTabKey = SubTab['key'];

// ─── Small local building blocks ────────────────────────────────────────
function TabBtn({ label, icon, active, onClick }: { label: string; icon?: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 8,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : SERA.card,
        color: active ? '#fff' : SERA.ink,
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function BlockChip({ label, pct, active, onClick }: { label: string; pct?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 8,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : '#fff',
        color: active ? '#fff' : SERA.ink,
        fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
      {pct !== undefined && (
        <span style={{ fontWeight: 700, opacity: active ? 1 : 0.75 }}>{fmtPct(pct)}</span>
      )}
    </button>
  );
}

function GroupBox({
  group, label, pct, tint, border, selected, onToggleBlock, onToggleGroup,
}: {
  group: (typeof SERA_BLOCKS_BY_GROUP)[number];
  label: string; pct: number; tint: string; border: string;
  selected: ReadonlySet<string>;
  onToggleBlock: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  const ids = group.blocks.map((b) => b.id);
  const groupActive = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <div style={{ background: tint, border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <BlockChip label={label} pct={pct} active={groupActive} onClick={() => onToggleGroup(ids)} />
        <span style={{ fontSize: 12, color: SERA.sub, fontStyle: 'italic' }}>Sene girizilmän</span>
        <button
          type="button"
          aria-label="Sene girmek"
          style={{ border: 'none', background: 'transparent', color: SERA.sub, cursor: 'pointer', display: 'flex' }}
        >
          <IconPencil size={13} />
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {group.blocks.map((b) => (
          <BlockChip
            key={b.id}
            label={b.name}
            pct={BLOCK_READINESS[b.id]}
            active={selected.has(b.id)}
            onClick={() => onToggleBlock(b.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BlockProgressCard({ data }: { data: BlockProgressCardData }) {
  return (
    <SeraCard
      title={data.name}
      extra={<span style={{ color: SERA.green, fontWeight: 700 }}>{fmtPct(data.pct)}</span>}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: data.dateRange ? SERA.ink : SERA.sub, fontStyle: data.dateRange ? 'normal' : 'italic' }}>
          {data.dateRange ?? 'Sene girizilmän'}
        </span>
        <button type="button" aria-label="Sene girmek" style={{ border: 'none', background: 'transparent', color: SERA.sub, cursor: 'pointer', display: 'flex' }}>
          <IconPencil size={13} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {data.subBlocks.map((s) => (
          <div key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: SERA.ink, width: 30, flexShrink: 0 }}>{s.code}</span>
            <Progress percent={s.pct} showInfo={false} strokeColor={SERA.amber} size={['100%', 8]} style={{ flex: 1 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: SERA.ink, width: 34, textAlign: 'right', flexShrink: 0 }}>{fmtPct(s.pct)}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${SERA.line}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SERA.sub }}>
          <span>{data.jobsDone}/{data.jobsTotal} iş</span>
          <span>{data.season}</span>
        </div>
        {data.blockDateRange && (
          <div style={{ fontSize: 12, color: SERA.sub }}>
            <b style={{ color: SERA.ink }}>Blok:</b> {data.blockDateRange}
          </div>
        )}
      </div>
    </SeraCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function SeraIzleme() {
  const [mainTab, setMainTab] = useState<MainTabKey>('ekis');
  const [subTab, setSubTab] = useState<SubTabKey>('umumy');
  const [askOpen, setAskOpen] = useState(false);
  const [season, setSeason] = useState<string>('2025-2026');
  const [block, setBlock] = useState<string>('DUS-A');
  const [selected, setSelected] = useState<string[]>([...IZLEME_DEFAULT_SELECTED]);

  const selectedSet = new Set(selected);
  const toggleBlock = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleGroup = (ids: string[]) => {
    setSelected((prev) => {
      const prevSet = new Set(prev);
      const allOn = ids.every((id) => prevSet.has(id));
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return [...next];
    });
  };

  const cards = IZLEME_BLOCK_CARDS.filter((c) => selectedSet.has(c.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconLeaf size={22} />}
        title="Sera Gözegçiligi"
        subtitle=" Temperatura · Çyglylyk · Gün şöhlesi · Kesel gözegçiligi — 10 sera"
        year={2026}
      />

      {/* Decorative "ask" bar */}
      <div
        onClick={() => setAskOpen((v) => !v)}
        style={{
          background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 12,
          padding: '10px 16px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.sub, fontSize: 13 }}>
          <IconMessageCircle2 size={16} /> Sera İzleme hakynda soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={16} style={{ transform: askOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s ease' }} />
      </div>

      {/* Main tabs */}
      <SeraCard padding={10}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {MAIN_TABS.map((t) => (
            <TabBtn key={t.key} label={t.label} icon={t.icon} active={mainTab === t.key} onClick={() => setMainTab(t.key)} />
          ))}
        </div>
      </SeraCard>

      {mainTab !== 'ekis' ? (
        <SeraCard>
          <div style={{ padding: 24, textAlign: 'center', color: SERA.sub, fontSize: 13 }}>
            Bu bölüm häzirlikçe taýýarlanýar…
          </div>
        </SeraCard>
      ) : (
        <>
          {/* Season + block select */}
          <SeraCard>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 6 }}>Möwsüm</div>
                <Select
                  value={season}
                  onChange={setSeason}
                  style={{ width: 160 }}
                  options={IZLEME_SEASONS.map((s) => ({ value: s, label: s }))}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 6 }}>Blok saýla</div>
                <Select
                  value={block}
                  onChange={setBlock}
                  style={{ width: 200 }}
                  showSearch
                  optionFilterProp="label"
                  options={SERA_BLOCKS.map((b) => ({ value: b.id, label: b.name }))}
                />
              </div>
            </div>
          </SeraCard>

          {/* Sub tabs */}
          <SeraCard padding={10}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SUB_TABS.map((t) => (
                <TabBtn key={t.key} label={t.label} icon={t.icon} active={subTab === t.key} onClick={() => setSubTab(t.key)} />
              ))}
            </div>
          </SeraCard>

          {subTab === 'umumy' && (
            <>
              <SeraCard>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                  <span style={{ fontWeight: 700, color: SERA.ink }}>Deňeşdiriljek bloklary saýlaň:</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setSelected(SERA_BLOCKS.map((b) => b.id))}
                      style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${SERA.line}`, background: SERA.card, color: SERA.ink, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Hemmesi
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected([])}
                      style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${SERA.line}`, background: SERA.card, color: SERA.ink, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Arassala
                    </button>
                  </div>
                </div>

                {GROUP_OVERVIEW.map((g) => {
                  const groupData = SERA_BLOCKS_BY_GROUP.find((x) => x.group === g.group);
                  if (!groupData) return null;
                  return (
                    <GroupBox
                      key={g.group}
                      group={groupData}
                      label={g.label}
                      pct={g.pct}
                      tint={g.tint}
                      border={g.border}
                      selected={selectedSet}
                      onToggleBlock={toggleBlock}
                      onToggleGroup={toggleGroup}
                    />
                  );
                })}
              </SeraCard>

              {cards.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  {cards.map((c) => (
                    <BlockProgressCard key={c.id} data={c} />
                  ))}
                </div>
              )}
            </>
          )}

          {subTab === 'girizme' && (
            <SeraCard>
              <div style={{ padding: 24, textAlign: 'center', color: SERA.sub, fontSize: 13 }}>
                Girizme (maglumat girizmek) bölümi häzirlikçe taýýarlanýar…
              </div>
            </SeraCard>
          )}

          {subTab === 'sazlama' && (
            <SeraCard>
              <div style={{ padding: 24, textAlign: 'center', color: SERA.sub, fontSize: 13 }}>
                Iş sazlamalary bölümi häzirlikçe taýýarlanýar…
              </div>
            </SeraCard>
          )}
        </>
      )}
    </div>
  );
}
