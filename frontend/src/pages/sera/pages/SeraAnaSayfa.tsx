import { Progress } from 'antd';
import {
  IconActivity, IconPlant2, IconFileInvoice, IconTruck,
  IconCurrencyDollar, IconReceipt2, IconTrendingUp, IconLeaf, IconBox,
} from '@tabler/icons-react';
import { SERA, fmtNum, fmtUsd } from '../seraTheme';
import { SERA_TOTALS, PLANTING_READINESS } from '../mock/seraData';

const CARD: React.CSSProperties = {
  background: SERA.card,
  border: `1px solid ${SERA.line}`,
  borderRadius: 14,
  padding: 18,
};

interface IndicatorRow {
  icon: React.ReactNode;
  label: string;
  plan: string;
  actual: string;
  actualColor: string;
  pct: number;
  tint: string;
}

const INDICATORS: IndicatorRow[] = [
  {
    icon: <IconPlant2 size={18} />, label: 'Önümçilik',
    plan: `${fmtNum(SERA_TOTALS.productionPlanKg, 1)} t`, actual: `${fmtNum(SERA_TOTALS.productionKg, 1)} t`,
    actualColor: SERA.pos, pct: 100, tint: SERA.greenLight,
  },
  {
    icon: <IconCurrencyDollar size={18} />, label: 'Girdeji',
    plan: fmtUsd(SERA_TOTALS.revenuePlanUsd), actual: fmtUsd(SERA_TOTALS.revenueUsd),
    actualColor: SERA.blue, pct: 100, tint: '#e6f0ff',
  },
  {
    icon: <IconReceipt2 size={18} />, label: 'Çykdajy',
    plan: fmtUsd(SERA_TOTALS.expensePlanUsd), actual: fmtUsd(SERA_TOTALS.expenseUsd),
    actualColor: SERA.amber, pct: 100, tint: '#fff4e0',
  },
  {
    icon: <IconTrendingUp size={18} />, label: 'Peýda',
    plan: fmtUsd(SERA_TOTALS.profitPlanUsd), actual: fmtUsd(SERA_TOTALS.profitUsd),
    actualColor: SERA.purple, pct: 100, tint: '#f2ecff',
  },
];

const HIGHLIGHTS = [
  { icon: <IconLeaf size={18} />, tint: SERA.greenLight, color: SERA.green, title: 'Meýilnama ýerine ýetirildi', text: 'Önümçilik boýunça ýyllyk meýilnama %100 derejede ýerine ýetirildi.' },
  { icon: <IconTrendingUp size={18} />, tint: '#f2ecff', color: SERA.purple, title: 'Peýda ösýär', text: `Peýda meýilnamanyň %100 derejesinde, ${fmtUsd(SERA_TOTALS.profitUsd)} gazanyldy.` },
  { icon: <IconBox size={18} />, tint: '#f2ecff', color: SERA.purple, title: 'Gaplama: 3 açyk maşyn', text: 'Häzirki wagtda 3 sany gaplama maşyny dowam edýär.' },
];

function DailyCol({ icon, tint, color, title, exportVal, localVal, note }: {
  icon: React.ReactNode; tint: string; color: string; title: string;
  exportVal?: string; localVal?: string; note?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 200, padding: 12, textAlign: 'center' }}>
      <div style={{ width: 42, height: 42, borderRadius: 10, background: tint, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        {icon}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: SERA.ink, marginBottom: 10 }}>{title}</div>
      {note ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 700, color: SERA.ink }}>—</div>
          <div style={{ fontSize: 12, color: SERA.sub, marginTop: 4 }}>{note}</div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: SERA.greenSoft, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 11, color: SERA.sub }}>Export + Gapy satyş</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: SERA.ink }}>{exportVal}</div>
          </div>
          <div style={{ background: '#fffbe6', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 11, color: SERA.sub }}>Içerki bazar</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: SERA.ink }}>{localVal}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SeraAnaSayfa() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Günlük Maglumat */}
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: SERA.ink }}>
            <IconActivity size={18} color={SERA.green} /> Günlük Maglumat
          </span>
          <span style={{ color: SERA.sub, fontSize: 13 }}>23 Iýul</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <DailyCol icon={<IconPlant2 size={20} />} tint={SERA.greenLight} color={SERA.green} title="Günlük Ýygylan Hasyl" exportVal="—" localVal="—" />
          <DailyCol icon={<IconFileInvoice size={20} />} tint="#e6f0ff" color={SERA.blue} title="Günlük Plan" exportVal="—" localVal="—" />
          <DailyCol icon={<IconTruck size={20} />} tint="#f2ecff" color={SERA.purple} title="Ýüklenen Tırlar" note="Heniz ýok" />
        </div>
      </div>

      {/* Welcome banner */}
      <div style={{ background: `linear-gradient(135deg, ${SERA.green}, ${SERA.greenDark})`, borderRadius: 14, padding: '20px 24px', color: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconLeaf size={24} />
        </div>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.85 }}>ÝYLADYŞHANA DOLANDYRYŞ ULGAMY</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Hoş geldiňiz, Yigit HJ export</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Penşenbe, 23 Iýul 2026</div>
        </div>
      </div>

      {/* Görkezijiler */}
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontWeight: 700, color: SERA.ink }}>Görkezijiler</span>
          <span style={{ color: SERA.sub, fontSize: 13 }}>2026 ýyllyk · Iýul aýyna çenli</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {INDICATORS.map((r) => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: r.tint, color: r.actualColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.icon}</span>
                  <span style={{ fontWeight: 700, color: SERA.ink }}>{r.label}</span>
                </span>
                <span style={{ fontWeight: 700, color: SERA.pos }}>%{r.pct}</span>
              </div>
              <div style={{ paddingLeft: 42 }}>
                <div style={{ fontSize: 13, color: SERA.sub }}>Meýilnama: <b style={{ color: SERA.ink }}>{r.plan}</b></div>
                <div style={{ fontSize: 13, color: SERA.sub, marginBottom: 6 }}>Ýerine ýetirilen: <b style={{ color: r.actualColor }}>{r.actual}</b></div>
                <Progress percent={r.pct} showInfo={false} strokeColor={SERA.pos} size={['100%', 8]} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ekişe Taýýarlyk */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: SERA.ink, marginBottom: 14 }}>
          <IconLeaf size={18} color={SERA.green} /> Ekişe Taýýarlyk
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {PLANTING_READINESS.map((p) => (
            <div key={p.region} style={{ flex: 1, minWidth: 200, textAlign: 'center', padding: 12 }}>
              <Progress type="circle" percent={p.pct} size={92} strokeColor={SERA.amber} format={(v) => <span style={{ color: SERA.amber, fontWeight: 700 }}>{v}%</span>} />
              <div style={{ fontWeight: 700, color: SERA.ink, marginTop: 10 }}>{p.region}</div>
              <div style={{ fontSize: 12, color: SERA.sub }}>Ekişe taýýarlyk</div>
            </div>
          ))}
        </div>
      </div>

      {/* Öne Çykanlar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 700, color: SERA.ink }}>Öne Çykanlar</span>
          <span style={{ color: SERA.green, fontSize: 13, cursor: 'pointer' }}>Hemmesini Gör ›</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} style={{ ...CARD, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ width: 36, height: 36, borderRadius: 9, background: h.tint, color: h.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{h.icon}</span>
              <div>
                <div style={{ fontWeight: 700, color: SERA.ink }}>{h.title}</div>
                <div style={{ fontSize: 13, color: SERA.sub }}>{h.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
