import { useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type { EChartsOption } from 'echarts';
import { Progress, Select, Button, DatePicker } from 'antd';
import {
  IconLeaf, IconMessageCircle2, IconChevronDown, IconSeeding, IconMap2,
  IconClock, IconAlertTriangle, IconTemperature, IconPencil, IconSettings,
  IconPlus, IconDownload, IconUpload, IconFileText, IconTrash, IconCircleCheck,
} from '@tabler/icons-react';
import { EChart } from '@/components/EChart';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../components/SeraMatrixTable';
import { SERA, fmtPct } from '../seraTheme';
import { SERA_BLOCKS, SERA_BLOCKS_BY_GROUP } from '../mock/seraData';
import {
  BLOCK_READINESS, GROUP_OVERVIEW, IZLEME_BLOCK_CARDS, IZLEME_SEASONS,
  IZLEME_DEFAULT_SELECTED, type BlockProgressCard as BlockProgressCardData,
  HEALTH_LEGEND, MAP_ROW_COUNT, IZLEME_RECORDS,
  DISEASE_BLOCK_CATEGORIES, DISEASE_BLOCK_COUNTS, DISEASE_TREND_DATES, DISEASE_TREND_COUNTS,
  SEVERITY_DIST, CLIMATE_TREND_DATES, CLIMATE_TREND_TEMP, CLIMATE_TREND_HUMIDITY,
  CLIMATE_TREND_SUN_HOURS, CLIMATE_TREND_JOULE_WANTED, CLIMATE_TREND_JOULE_ACTUAL,
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

// ─── Sera Kartasy (Sera Haritası) tab ────────────────────────────────────
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: SERA.sub, whiteSpace: 'nowrap' }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function SeraHaritaTab() {
  const [mapBlockId, setMapBlockId] = useState<string>('DUS-A');
  const [mapDate, setMapDate] = useState<Dayjs>(dayjs('2026-07-24'));

  const block = SERA_BLOCKS.find((b) => b.id === mapBlockId) ?? SERA_BLOCKS[0];
  const rowPrefix = block.name.split(' ')[1] ?? 'A';
  const rows = Array.from({ length: MAP_ROW_COUNT }, (_, i) => `${rowPrefix}${String(i + 1).padStart(2, '0')}`);

  return (
    <>
      <SeraCard>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          <FilterField label="Sera">
            <Select
              value={mapBlockId}
              onChange={setMapBlockId}
              style={{ width: 200 }}
              showSearch
              optionFilterProp="label"
              options={SERA_BLOCKS.map((b) => ({ value: b.id, label: b.name }))}
            />
          </FilterField>
          <FilterField label="Sene">
            <DatePicker value={mapDate} onChange={(d) => d && setMapDate(d)} format="MM/DD/YYYY" style={{ width: 160 }} />
          </FilterField>
          <Button type="primary" icon={<IconPlus size={15} />} style={{ background: SERA.green, borderColor: SERA.green }}>
            Ýazgy goş
          </Button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginLeft: 'auto' }}>
            {HEALTH_LEGEND.map((l) => (
              <LegendDot key={l.label} label={l.label} color={l.color} />
            ))}
          </div>
        </div>
      </SeraCard>

      <SeraCard
        title={`${block.name} — Hatar meýilnamasy · ${mapDate.format('YYYY-MM-DD')}`}
        extra={`0 / ${MAP_ROW_COUNT} hatar ýazgyly`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 520, overflowY: 'auto' }}>
          {rows.map((r) => (
            <div
              key={r}
              style={{
                padding: '9px 12px', borderRadius: 6,
                background: SERA.bg, color: SERA.sub, fontSize: 11, fontWeight: 600,
              }}
            >
              {r}
            </div>
          ))}
        </div>
      </SeraCard>

      <SeraCard title="Ähli bloklar — Umumy ýagdaý">
        {SERA_BLOCKS_BY_GROUP.map((g) => (
          <div key={g.group} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: SERA.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, textAlign: 'center' }}>
              {g.group}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {g.blocks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setMapBlockId(b.id)}
                  style={{
                    textAlign: 'left', border: `1px solid ${b.id === mapBlockId ? SERA.green : SERA.line}`,
                    borderRadius: 10, padding: '10px 12px', cursor: 'pointer', background: '#fff',
                  }}
                >
                  <div style={{ fontWeight: 700, color: SERA.ink, fontSize: 13 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: SERA.sub }}>Ýazgy ýok</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </SeraCard>
    </>
  );
}

// ─── Ýazgylar (Kayıtlar) tab ─────────────────────────────────────────────
function HealthBadge({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 20,
        background: ok ? SERA.greenLight : '#fee2e2', color: ok ? SERA.green : SERA.neg, fontSize: 12, fontWeight: 600,
      }}
    >
      {ok && <IconCircleCheck size={13} />} {ok ? 'Ýok' : 'Bar'}
    </span>
  );
}

function RecordIconBtn({ icon, ariaLabel }: { icon: React.ReactNode; ariaLabel: string }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={{
        border: `1px solid ${SERA.line}`, background: '#fff', borderRadius: 6, width: 26, height: 26,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: SERA.sub,
      }}
    >
      {icon}
    </button>
  );
}

function YazgylarTab() {
  const [filterBlock, setFilterBlock] = useState<string>('all');
  const [filterRow, setFilterRow] = useState<string>('all');
  const [filterDisease, setFilterDisease] = useState<string>('all');

  const rowOptions = Array.from({ length: MAP_ROW_COUNT }, (_, i) => `A${String(i + 1).padStart(2, '0')}`);

  const headers = [
    'Sera', 'Hatar', 'Sene', 'Gyzgynlyk (°C)', 'Çyglylyk (%)', 'Gün şöhlesi (sagat)',
    'Joule isl. (J)', 'Joule ýer. (J)', 'Kesel', 'Kesel görnüşi', 'Derejesi', 'Täsir %', 'Bellikler', '',
  ];
  const rows: MatrixRow[] = IZLEME_RECORDS.map((r) => ({
    label: r.seraNo,
    cells: [
      r.rowCode, r.date, `${r.tempC}°`, `${r.humidityPct}%`, r.sunHours,
      '—', '—',
      <HealthBadge key="health" ok={r.isHealthy} />,
      '—', '—', '—',
      r.notes || '—',
      <div key="actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <RecordIconBtn icon={<IconPencil size={13} />} ariaLabel="Üýtget" />
        <RecordIconBtn icon={<IconTrash size={13} />} ariaLabel="Poz" />
      </div>,
    ],
  }));

  return (
    <>
      <SeraCard>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end', marginBottom: 16 }}>
          <FilterField label="Blok / Sera">
            <Select
              value={filterBlock}
              onChange={setFilterBlock}
              style={{ width: 180 }}
              options={[{ value: 'all', label: 'Ähli bloklar' }, ...SERA_BLOCKS.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </FilterField>
          <FilterField label="Hatar (A01–A49)">
            <Select
              value={filterRow}
              onChange={setFilterRow}
              style={{ width: 160 }}
              options={[{ value: 'all', label: 'Ähli hatarlar' }, ...rowOptions.map((r) => ({ value: r, label: r }))]}
            />
          </FilterField>
          <FilterField label="Başlangyç">
            <DatePicker style={{ width: 150 }} placeholder="aa/gg/ýýýý" />
          </FilterField>
          <FilterField label="Gutarnyk">
            <DatePicker style={{ width: 150 }} placeholder="aa/gg/ýýýý" />
          </FilterField>
          <FilterField label="Kesel">
            <Select
              value={filterDisease}
              onChange={setFilterDisease}
              style={{ width: 150 }}
              options={[
                { value: 'all', label: 'Ählisi' },
                { value: 'sick', label: 'Keselli' },
                { value: 'healthy', label: 'Sagdyn' },
              ]}
            />
          </FilterField>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button type="primary" icon={<IconPlus size={15} />} style={{ background: SERA.green, borderColor: SERA.green }}>
              Täze ýazgy
            </Button>
            <Button icon={<IconDownload size={15} />}>CSV göçürip al</Button>
            <Button icon={<IconUpload size={15} />}>CSV ýükle</Button>
            <Button icon={<IconFileText size={15} />}>CSV şablony</Button>
          </div>
          <span style={{ fontSize: 12, color: SERA.sub }}>{IZLEME_RECORDS.length} ýazgy tapyldy</span>
        </div>
      </SeraCard>

      <SeraCard padding={0} style={{ overflow: 'hidden' }}>
        <SeraMatrixTable headers={headers} rows={rows} numeric={false} minWidth={1180} />
      </SeraCard>
    </>
  );
}

// ─── Kesel (Hastalık) tab ────────────────────────────────────────────────
function CardTitle({ label }: { label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <IconAlertTriangle size={15} color={SERA.red} /> {label}
    </span>
  );
}

function SeverityTile({ value, label, tint, color }: { value: number; label: string; tint: string; color: string }) {
  return (
    <div style={{ background: tint, borderRadius: 12, padding: '20px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: SERA.sub, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function KeselTab() {
  const barOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: [...DISEASE_BLOCK_CATEGORIES], axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', max: 4, minInterval: 1 },
    series: [{ type: 'bar', data: [...DISEASE_BLOCK_COUNTS], itemStyle: { color: SERA.red }, barWidth: 24 }],
  };
  const trendOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: [...DISEASE_TREND_DATES] },
    yAxis: { type: 'value', max: 4, minInterval: 1 },
    series: [{ type: 'line', data: [...DISEASE_TREND_COUNTS], itemStyle: { color: SERA.red }, lineStyle: { color: SERA.red } }],
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <SeraCard title={<CardTitle label="Kesel görnüşi paýlanyşy" />}>
          <div style={{ padding: '48px 0', textAlign: 'center', color: SERA.sub, fontSize: 13 }}>
            Kesel ýazgysy ýok
          </div>
        </SeraCard>
        <SeraCard title={<CardTitle label="Sera boýunça kesel sany" />}>
          <EChart option={barOption} height={260} ariaLabel="Sera boýunça kesel sany" />
        </SeraCard>
      </div>

      <SeraCard title={<CardTitle label="Günlük kesel tendensiýasy (soňky 90 gün)" />}>
        <EChart option={trendOption} height={260} ariaLabel="Günlük kesel tendensiýasy, soňky 90 gün" />
      </SeraCard>

      <SeraCard title="Agyrlyk derejesi paýlanyşy">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <SeverityTile value={SEVERITY_DIST.light} label="Ýeňil" tint="#fef9c3" color="#ca8a04" />
          <SeverityTile value={SEVERITY_DIST.medium} label="Orta" tint="#fef3c7" color="#d97706" />
          <SeverityTile value={SEVERITY_DIST.severe} label="Agyr" tint="#fee2e2" color={SERA.neg} />
        </div>
      </SeraCard>
    </>
  );
}

// ─── Howa & Yşyk (İklim & Işık) tab ──────────────────────────────────────
function HowaTab() {
  const tempHumidityOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Gyzgynlyk', 'Çyglylyk'], bottom: 0 },
    grid: { left: 50, right: 50, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: [...CLIMATE_TREND_DATES] },
    yAxis: [
      { type: 'value', name: '°C', max: 28 },
      { type: 'value', name: '%', max: 80, splitLine: { show: false } },
    ],
    series: [
      { name: 'Gyzgynlyk', type: 'line', data: [...CLIMATE_TREND_TEMP], itemStyle: { color: SERA.amber }, yAxisIndex: 0 },
      { name: 'Çyglylyk', type: 'line', data: [...CLIMATE_TREND_HUMIDITY], itemStyle: { color: SERA.blue }, yAxisIndex: 1 },
    ],
  };
  const sunOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: [...CLIMATE_TREND_DATES] },
    yAxis: { type: 'value', max: 16 },
    series: [{ type: 'line', data: [...CLIMATE_TREND_SUN_HOURS], itemStyle: { color: SERA.amber } }],
  };
  const jouleOption: EChartsOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Islenen (J)', 'Ýerine ýetirilen (J)'], bottom: 0 },
    grid: { left: 40, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: [...CLIMATE_TREND_DATES] },
    yAxis: { type: 'value' },
    series: [
      { name: 'Islenen (J)', type: 'line', data: [...CLIMATE_TREND_JOULE_WANTED], itemStyle: { color: SERA.green } },
      { name: 'Ýerine ýetirilen (J)', type: 'line', data: [...CLIMATE_TREND_JOULE_ACTUAL], itemStyle: { color: SERA.amber } },
    ],
  };

  const avgRows: MatrixRow[] = SERA_BLOCKS.map((b) => ({
    label: b.name,
    cells: ['0', '—', '—', '—', '—', '—', '—'],
  }));

  return (
    <>
      <SeraCard title="Gyzgynlyk & Çyglylyk tendensiýasy (soňky 90 gün)">
        <EChart option={tempHumidityOption} height={280} ariaLabel="Gyzgynlyk we çyglylyk tendensiýasy, soňky 90 gün" />
      </SeraCard>
      <SeraCard title="Günlük gün şöhle sagady tendensiýasy (soňky 90 gün)">
        <EChart option={sunOption} height={260} ariaLabel="Günlük gün şöhle sagady tendensiýasy, soňky 90 gün" />
      </SeraCard>
      <SeraCard title="Joule islenen we ýerine ýetirilen (soňky 90 gün)">
        <EChart option={jouleOption} height={260} ariaLabel="Joule islenen we ýerine ýetirilen, soňky 90 gün" />
      </SeraCard>
      <SeraCard title="Sera boýunça ortaça bahalar">
        <SeraMatrixTable
          headers={['Sera', 'Ýazgy', 'Ort. gyzgynlyk', 'Ort. çyglylyk', 'Ort. gün şöhlesi', 'Joule isl. (J)', 'Joule ýer. (J)', 'Soňky sene']}
          rows={avgRows}
          numeric={false}
          minWidth={900}
        />
      </SeraCard>
    </>
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

      {mainTab === 'harita' && <SeraHaritaTab />}
      {mainTab === 'ýazgy' && <YazgylarTab />}
      {mainTab === 'kesel' && <KeselTab />}
      {mainTab === 'howa' && <HowaTab />}

      {mainTab === 'ekis' && (
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
