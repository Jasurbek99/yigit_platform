import { Fragment, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Button, InputNumber, Select, Space, Input } from 'antd';
import {
  IconPackage, IconHelpCircle, IconChevronDown, IconChevronUp,
  IconTrash, IconPencil, IconPlus,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtKg, fmtUsd, fmtDtm } from '../../seraTheme';
import { MONTHS_TR } from '../../mock/seraData';
import {
  STANDARD_TIR_KG, PRODUCT_TYPES, MONTHLY_EXPORT_KG, YEARLY_TOTAL_USD,
  GAPLAMA_ITEMS, GAPLAMA_GRUP_TOPLAMI, GUMRUKLEME_ITEMS, GUMRUKLEME_GRUP_TOPLAMI,
  NAKLIYE, DASARY_GUMRUKLEME, SATYS_ILISIKLI_GROUPS, ISGARLER_AUTO_ROW, SATYS_ILISIKLI_TOPLAM,
  AYLIK_OZET, AYLIK_GENEL_TOPLAM,
  type ExpenseItem, type ProductType, type CountryLine,
} from '../../mock/pazarlamaGaplama';

// ─── Shared table cell styles ────────────────────────────────────────────
const th: CSSProperties = { padding: '6px 10px', textAlign: 'right', color: SERA.sub, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `2px solid ${SERA.line}`, whiteSpace: 'nowrap' };
const thLeft: CSSProperties = { ...th, textAlign: 'left' };
const td: CSSProperties = { padding: '6px 10px', fontSize: 12.5, borderBottom: `1px solid ${SERA.line}`, whiteSpace: 'nowrap' };
const tdNum: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const tdLabel: CSSProperties = { ...td, textAlign: 'left', fontWeight: 500 };
const tdSub: CSSProperties = { ...tdLabel, color: SERA.sub, fontSize: 12, paddingLeft: 22 };
const footerRow: CSSProperties = { background: SERA.slate, color: '#fff' };

function cellOrDash(v: number | null, fmt: (n: number) => string): string {
  return v === null ? '—' : fmt(v);
}

function fmtTir(v: number): string {
  return `${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} tır`;
}

const HESAP_TURU_OPTIONS: ReadonlyArray<{ value: ExpenseItem['hesapTuru']; label: string }> = [
  { value: 'Kg (İhracat)', label: 'Kg (İhracat)' },
  { value: 'Tır', label: 'Tır' },
  { value: 'İç Pazar Yeşigi', label: 'İç Pazar Yeşigi' },
];

// ─── 760.01 / 760.02 — expense item table (Tır/Yeşik toggle + reorder) ───
interface ItemTableProps {
  readonly items: readonly ExpenseItem[];
  readonly onChange: (items: ExpenseItem[]) => void;
  readonly grupToplam: { readonly monthly: readonly (number | null)[]; readonly toplam: number };
  readonly newItemName: string;
  readonly onNewItemNameChange: (v: string) => void;
  readonly onAddItem: () => void;
}

function ItemTable({ items, onChange, grupToplam, newItemName, onNewItemNameChange, onAddItem }: ItemTableProps) {
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const patch = (idx: number, partial: Partial<ExpenseItem>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...partial };
    onChange(next);
  };
  const amountFmt = (v: number, currency: ExpenseItem['paraBirimi']) => (currency === 'DTM' ? fmtDtm(v) : fmtUsd(v));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 2100, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thLeft}>Kalem</th>
            <th style={thLeft}>Hesap Türü</th>
            <th style={th}>Birim Fiyat</th>
            <th style={thLeft}>Para Birimi</th>
            {MONTHS_TR.map((m) => <th key={m} style={th}>{m}</th>)}
            <th style={th}>Toplam</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <Fragment key={item.id}>
              <tr>
                <td style={tdLabel}>{item.name}</td>
                <td style={td}>
                  <Select<ExpenseItem['hesapTuru']>
                    size="small" value={item.hesapTuru} style={{ width: 200 }}
                    options={HESAP_TURU_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.value === 'İç Pazar Yeşigi' ? o.label : `${item.name} / ${o.label}`,
                    }))}
                    onChange={(v) => patch(idx, { hesapTuru: v })}
                  />
                </td>
                <td style={td}>
                  <InputNumber size="small" value={item.birimFiyat} style={{ width: 80 }} min={0}
                    onChange={(v) => patch(idx, { birimFiyat: v ?? 0 })} />
                </td>
                <td style={td}>
                  <Select<ExpenseItem['paraBirimi']> size="small" value={item.paraBirimi} style={{ width: 80 }}
                    options={[{ value: 'DTM', label: 'DTM' }, { value: 'USD', label: 'USD' }]}
                    onChange={(v) => patch(idx, { paraBirimi: v })} />
                </td>
                {item.monthly.map((m, i) => <td key={i} style={tdNum}>{amountFmt(m, item.paraBirimi)}</td>)}
                <td style={{ ...tdNum, fontWeight: 700 }}>{amountFmt(item.toplam, item.paraBirimi)}</td>
                <td style={td}>
                  <Space size={0}>
                    <Button size="small" type="text" disabled={idx === 0} icon={<IconChevronUp size={14} />} onClick={() => move(idx, -1)} />
                    <Button size="small" type="text" disabled={idx === items.length - 1} icon={<IconChevronDown size={14} />} onClick={() => move(idx, 1)} />
                    <Button size="small" type="text" danger icon={<IconTrash size={14} />} onClick={() => remove(idx)} />
                  </Space>
                </td>
              </tr>
              {item.hesapTuru === 'Tır' ? (
                <>
                  <tr key={`${item.id}-tir`}>
                    <td style={tdSub}>↳ Tır parametreleri</td>
                    <td colSpan={3} style={{ ...td, color: SERA.sub, fontSize: 12 }}>
                      <div>Tır kapasitesi: <b style={{ color: SERA.ink }}>{fmtKg(STANDARD_TIR_KG)}</b> <span>(Blok Ayarları&apos;ndan değiştir)</span></div>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Birim / Tır: <InputNumber size="small" value={item.birimPerTir} style={{ width: 70 }} min={0}
                          onChange={(v) => patch(idx, { birimPerTir: v ?? 0 })} />
                      </div>
                    </td>
                    {(item.tirMonthly ?? []).map((v, i) => <td key={i} style={tdNum}>{fmtTir(v)}</td>)}
                    <td colSpan={2} style={td} />
                  </tr>
                  <tr key={`${item.id}-birim`}>
                    <td style={tdSub}>↳ Birim sayısı</td>
                    <td colSpan={3} style={td} />
                    {(item.birimSayisiMonthly ?? []).map((v, i) => <td key={i} style={tdNum}>{v === null ? '—' : fmtNum(v)}</td>)}
                    <td style={{ ...tdNum, fontWeight: 700 }}>{fmtNum(item.birimSayisiToplam ?? 0)}</td>
                    <td style={td} />
                  </tr>
                </>
              ) : (
                <>
                  <tr key={`${item.id}-param`}>
                    <td style={tdSub}>↳ Parametreler</td>
                    <td colSpan={3} style={{ ...td, color: SERA.sub, fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        1 yeşige (kg): <InputNumber size="small" value={item.perYesikKg} style={{ width: 70 }} min={0}
                          onChange={(v) => patch(idx, { perYesikKg: v ?? 0 })} />
                      </div>
                    </td>
                    {(item.yesikKgMonthly ?? []).map((v, i) => <td key={i} style={tdNum}>{fmtKg(v)}</td>)}
                    <td colSpan={2} style={td} />
                  </tr>
                  <tr key={`${item.id}-yesik`}>
                    <td style={tdSub}>↳ Yeşige sayısı</td>
                    <td colSpan={3} style={td} />
                    {(item.yesikSayisiMonthly ?? []).map((v, i) => <td key={i} style={tdNum}>{v === null ? '—' : `${fmtNum(v)} yş`}</td>)}
                    <td style={{ ...tdNum, fontWeight: 700 }}>{fmtNum(item.yesikSayisiToplam ?? 0)} yş</td>
                    <td style={td} />
                  </tr>
                </>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr style={footerRow}>
            <td colSpan={4} style={{ ...tdLabel, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>Grup Toplamı</td>
            {grupToplam.monthly.map((v, i) => <td key={i} style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{cellOrDash(v, fmtDtm)}</td>)}
            <td style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{fmtDtm(grupToplam.toplam)}</td>
            <td style={{ borderBottom: 'none' }} />
          </tr>
        </tfoot>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input size="small" placeholder="Yeni kalem adı..." value={newItemName} style={{ maxWidth: 260 }}
          onChange={(e) => onNewItemNameChange(e.target.value)} />
        <Button size="small" icon={<IconPlus size={14} />} onClick={onAddItem}>Ekle</Button>
      </div>
    </div>
  );
}

// ─── 760.03 / 760.04 — country-based (Yurt / Satır) table ────────────────
interface CountryTableProps {
  readonly kazakistan: CountryLine;
  readonly rusya: CountryLine;
  readonly toplamLabel: string;
  readonly toplamMonthly: readonly (number | null)[];
  readonly toplamUsd: number;
}

function CountryBlock({ line }: { readonly line: CountryLine }) {
  const yillikUsd = line.fiyatRows.reduce((s, r) => s + r.toplamUsd, 0);
  return (
    <>
      <tr>
        <td style={tdLabel}>{line.country}</td>
        {line.kgMonthly.map((kg, i) => (
          <td key={i} style={tdNum}>
            <div>{fmtKg(kg)}</div>
            <div style={{ color: SERA.sub, fontSize: 11 }}>{fmtTir(line.tirMonthly[i])}</div>
          </td>
        ))}
        <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(yillikUsd)}</td>
      </tr>
      {line.fiyatRows.map((row) => (
        <tr key={row.label}>
          <td style={tdSub}>↳ {row.label}</td>
          {row.values.map((v, i) => (
            <td key={i} style={td}><InputNumber size="small" defaultValue={v} style={{ width: 76 }} min={0} /></td>
          ))}
          <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(row.toplamUsd)}</td>
        </tr>
      ))}
      <tr>
        <td style={tdSub}>↳ Tutar (USD)</td>
        {line.tutarMonthly.map((v, i) => <td key={i} style={tdNum}>{cellOrDash(v, fmtUsd)}</td>)}
        <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(line.tutarToplam)}</td>
      </tr>
    </>
  );
}

function CountryTable({ kazakistan, rusya, toplamLabel, toplamMonthly, toplamUsd }: CountryTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 1600, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thLeft}>Yurt / Satır</th>
            {MONTHS_TR.map((m) => <th key={m} style={th}>{m}</th>)}
            <th style={th}>Yıllık</th>
          </tr>
        </thead>
        <tbody>
          <CountryBlock line={kazakistan} />
          <CountryBlock line={rusya} />
        </tbody>
        <tfoot>
          <tr style={footerRow}>
            <td style={{ ...tdLabel, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{toplamLabel}</td>
            {toplamMonthly.map((v, i) => <td key={i} style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{cellOrDash(v, fmtUsd)}</td>)}
            <td style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{fmtUsd(toplamUsd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── 760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar ──────────
function SalesRelatedTable() {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 1600, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thLeft}>Kalem / Yurt / Satır</th>
            {MONTHS_TR.map((m) => <th key={m} style={th}>{m}</th>)}
            <th style={th}>Yıllık</th>
          </tr>
        </thead>
        <tbody>
          {SATYS_ILISIKLI_GROUPS.map((g) => (
            <Fragment key={g.label}>
              <tr>
                <td style={tdLabel}>{g.label}</td>
                {MONTHS_TR.map((m) => <td key={m} style={tdNum}>—</td>)}
                <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(g.toplamUsd)}</td>
              </tr>
              <tr key={`${g.label}-kz`}>
                <td style={tdSub}>↳ Kazakistan — Fiyat</td>
                {g.kazakistanFiyat.map((v, i) => (
                  <td key={i} style={td}><InputNumber size="small" defaultValue={v} style={{ width: 76 }} min={0} /></td>
                ))}
                <td style={td} />
              </tr>
              <tr key={`${g.label}-kz-tutar`}>
                <td style={tdSub}>↳ Tutar</td>
                {MONTHS_TR.map((m) => <td key={m} style={tdNum}>—</td>)}
                <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(0)}</td>
              </tr>
              <tr key={`${g.label}-ru`}>
                <td style={tdSub}>↳ Rusya — Fiyat</td>
                {g.rusyaFiyat.map((v, i) => (
                  <td key={i} style={td}><InputNumber size="small" defaultValue={v} style={{ width: 76 }} min={0} /></td>
                ))}
                <td style={td} />
              </tr>
              <tr key={`${g.label}-ru-tutar`}>
                <td style={tdSub}>↳ Tutar</td>
                {MONTHS_TR.map((m) => <td key={m} style={tdNum}>—</td>)}
                <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(0)}</td>
              </tr>
            </Fragment>
          ))}
          <tr>
            <td style={tdLabel}>{ISGARLER_AUTO_ROW.label}</td>
            {ISGARLER_AUTO_ROW.monthly.map((v, i) => <td key={i} style={tdNum}>{cellOrDash(v, fmtUsd)}</td>)}
            <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(ISGARLER_AUTO_ROW.toplam)}</td>
          </tr>
          <tr>
            <td style={tdSub}>↳ Kazakistan</td>
            {ISGARLER_AUTO_ROW.kazakistanKisi.map((v, i) => <td key={i} style={tdNum}>{fmtNum(v)} kişi</td>)}
            <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(ISGARLER_AUTO_ROW.kazakistanToplamUsd)}</td>
          </tr>
          <tr>
            <td style={tdSub}>↳ Rusya</td>
            {ISGARLER_AUTO_ROW.rusyaKisi.map((v, i) => <td key={i} style={tdNum}>{fmtNum(v)} kişi</td>)}
            <td style={{ ...tdNum, fontWeight: 700 }}>{fmtUsd(ISGARLER_AUTO_ROW.rusyaToplamUsd)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style={footerRow}>
            <td style={{ ...tdLabel, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>760.05 Toplamı</td>
            {SATYS_ILISIKLI_TOPLAM.monthly.map((v, i) => <td key={i} style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{cellOrDash(v, fmtUsd)}</td>)}
            <td style={{ ...tdNum, color: '#fff', fontWeight: 700, borderBottom: 'none' }}>{fmtUsd(SATYS_ILISIKLI_TOPLAM.toplam)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Section header (title + right-side amount / note) ──────────────────
function SectionHeader({ title, extra }: { readonly title: string; readonly extra: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
      <span style={{ fontWeight: 700, color: SERA.ink }}>{title}</span>
      <span style={{ textAlign: 'right', fontSize: 13, color: SERA.green, fontWeight: 700 }}>{extra}</span>
    </div>
  );
}

function Note({ children }: { readonly children: ReactNode }) {
  return <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>Not: {children}</div>;
}

// ─── Product type chip ────────────────────────────────────────────────
function ProductChip({ product, active, onSelect, onRename, onDelete }: {
  readonly product: ProductType; readonly active: boolean;
  readonly onSelect: () => void; readonly onRename: () => void; readonly onDelete?: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px 4px 12px', borderRadius: 8,
      border: `1px solid ${active ? SERA.green : SERA.line}`, background: active ? SERA.green : SERA.card,
    }}>
      <button type="button" onClick={onSelect} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: active ? '#fff' : SERA.ink, padding: 0 }}>
        {product.name}
      </button>
      <Button size="small" type="text" icon={<IconPencil size={13} color={active ? '#fff' : SERA.sub} />} onClick={onRename} />
      {onDelete && <Button size="small" type="text" icon={<IconTrash size={13} color={active ? '#fff' : SERA.sub} />} onClick={onDelete} />}
    </div>
  );
}

export default function PazarlamaGaplama() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [products, setProducts] = useState<ProductType[]>([...PRODUCT_TYPES]);
  const [selectedProduct, setSelectedProduct] = useState('domates');
  const [tirKapasitesi, setTirKapasitesi] = useState(STANDARD_TIR_KG);

  const [gaplamaItems, setGaplamaItems] = useState<ExpenseItem[]>([...GAPLAMA_ITEMS]);
  const [gaplamaNewName, setGaplamaNewName] = useState('');
  const [gumruklemeItems, setGumruklemeItems] = useState<ExpenseItem[]>([...GUMRUKLEME_ITEMS]);
  const [gumruklemeNewName, setGumruklemeNewName] = useState('');

  const addItem = (name: string, setter: (items: ExpenseItem[]) => void, current: ExpenseItem[]) => {
    if (!name.trim()) return;
    const blank: ExpenseItem = {
      id: `custom-${Date.now()}`, name: name.trim(), hesapTuru: 'İç Pazar Yeşigi', birimFiyat: 0, paraBirimi: 'DTM',
      monthly: MONTHLY_EXPORT_KG.map(() => 0), toplam: 0,
      perYesikKg: 6, yesikKgMonthly: MONTHLY_EXPORT_KG, yesikSayisiMonthly: MONTHLY_EXPORT_KG.map(() => null), yesikSayisiToplam: 0,
    };
    setter([...current, blank]);
  };

  const renameProduct = (code: string) => {
    const next = window.prompt('Ürün türü adı:');
    if (next && next.trim()) setProducts((prev) => prev.map((p) => (p.code === code ? { ...p, name: next.trim() } : p)));
  };
  const addProduct = () => {
    const code = `custom-${Date.now()}`;
    setProducts((prev) => [...prev, { code, name: 'Täze önüm' }]);
    setSelectedProduct(code);
  };
  const deleteProduct = (code: string) => {
    setProducts((prev) => prev.filter((p) => p.code !== code));
    if (selectedProduct === code) setSelectedProduct('domates');
  };

  const selectedProductName = products.find((p) => p.code === selectedProduct)?.name ?? 'Domates';
  const isDomates = selectedProduct === 'domates';

  const ozetRows: MatrixRow[] = AYLIK_OZET.map((r) => ({
    label: r.label,
    cells: [...r.monthly.map((v) => cellOrDash(v, fmtUsd)), <b>{fmtUsd(r.toplam)}</b>],
  }));
  const ozetFooter: MatrixRow = {
    label: AYLIK_GENEL_TOPLAM.label,
    cells: [...AYLIK_GENEL_TOPLAM.monthly.map((v) => cellOrDash(v, fmtUsd)), fmtUsd(AYLIK_GENEL_TOPLAM.toplam)],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconPackage size={22} />}
        title="Pazarlama & Gaplama (760)"
        subtitle="Ürün türüne göre ayrı paketleme, gümrük, nakliye gider tabloları. Export kg'dan otomatik miktar hesaplanır."
        accent="#ea580c"
        accentDark="#9a3412"
        extra={
          <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.16)', textAlign: 'right' }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Yıllık Toplam (1 blok)</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtUsd(YEARLY_TOTAL_USD)}</div>
          </div>
        }
      />

      {/* Help / ask row */}
      <SeraCard padding={14}>
        <div
          role="button" tabIndex={0} onClick={() => setHelpOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.sub, fontSize: 13 }}>
            <IconHelpCircle size={17} color={SERA.green} />
            Pazarlama &amp; Gaplama (760) hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          {helpOpen ? <IconChevronUp size={16} color={SERA.sub} /> : <IconChevronDown size={16} color={SERA.sub} />}
        </div>
        {helpOpen && (
          <div style={{ marginTop: 12, fontSize: 13, color: SERA.ink, lineHeight: 1.6 }}>
            Aylık gaplama/gümrük tutarları, o ayın Export + Kapı Satış miktarı (kg) üzerinden otomatik hesaplanır.
            Nakliye ve daşary ýurt çykdajylary yurt bazlı export tır sayısından; işgär çykdajysy Personel sayfasından
            otomatik çekilir. Standart Tır Kapasitesi değerini değiştirmek tüm kalemleri yeniden hesaplar.
          </div>
        )}
      </SeraCard>

      {/* Product type selector */}
      <SeraCard title="Ürün Türü" extra={<Button size="small" icon={<IconPlus size={14} />} onClick={addProduct}>Ürün Ekle</Button>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {products.map((p) => (
            <ProductChip
              key={p.code} product={p} active={p.code === selectedProduct}
              onSelect={() => setSelectedProduct(p.code)} onRename={() => renameProduct(p.code)}
              onDelete={p.code === 'domates' ? undefined : () => deleteProduct(p.code)}
            />
          ))}
        </div>
      </SeraCard>

      {/* Standard truck capacity */}
      <SeraCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: SERA.ink, minWidth: 180 }}>Standart Tır Kapasitesi</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InputNumber size="middle" value={tirKapasitesi} min={0} step={100} onChange={(v) => setTirKapasitesi(v ?? 0)} style={{ width: 130 }} />
            <span style={{ color: SERA.sub }}>kg</span>
          </div>
          <span style={{ fontSize: 12, color: SERA.sub }}>Tır bazlı tüm hesaplamalar bu değeri kullanır. Değiştirince tüm kalemler otomatik güncellenir.</span>
        </div>
      </SeraCard>

      {!isDomates ? (
        <SeraCard>
          <div style={{ color: SERA.sub, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            {selectedProductName} için henüz gider verisi girilmedi.
          </div>
        </SeraCard>
      ) : (
        <>
          {/* Monthly export + kapı satış kg strip */}
          <SeraCard title={`Aylık Export + Kapı Satış kg — ${selectedProductName} (tüm bloklar, iç pazar hariç)`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              {MONTHS_TR.map((m, i) => (
                <div key={m} style={{ minWidth: 96 }}>
                  <div style={{ fontSize: 12, color: SERA.sub }}>{m}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: SERA.ink }}>{fmtKg(MONTHLY_EXPORT_KG[i])}</div>
                </div>
              ))}
            </div>
          </SeraCard>

          {/* 760.01 */}
          <SeraCard>
            <SectionHeader title="760.01 — Gaplama Çykdajylary" extra={fmtUsd(0)} />
            <Note>Aylık tutarlar, o ayın Export+Kapı satış miktarı (kg) üzerinden hesaplanır — Satış sayfasındaki dağılım verisinden gelir.</Note>
            <ItemTable
              items={gaplamaItems} onChange={setGaplamaItems} grupToplam={GAPLAMA_GRUP_TOPLAMI}
              newItemName={gaplamaNewName} onNewItemNameChange={setGaplamaNewName}
              onAddItem={() => { addItem(gaplamaNewName, setGaplamaItems, gaplamaItems); setGaplamaNewName(''); }}
            />
          </SeraCard>

          {/* 760.02 */}
          <SeraCard>
            <SectionHeader title="760.02 — Gümrükleme (Gümrük çykdajylary)" extra={fmtUsd(0)} />
            <Note>Aylık tutarlar, o ayın Export+Kapı satış miktarı (kg) üzerinden hesaplanır — Satış sayfasındaki dağılım verisinden gelir.</Note>
            <ItemTable
              items={gumruklemeItems} onChange={setGumruklemeItems} grupToplam={GUMRUKLEME_GRUP_TOPLAMI}
              newItemName={gumruklemeNewName} onNewItemNameChange={setGumruklemeNewName}
              onAddItem={() => { addItem(gumruklemeNewName, setGumruklemeItems, gumruklemeItems); setGumruklemeNewName(''); }}
            />
          </SeraCard>

          {/* 760.03 — Nakliye */}
          <SeraCard>
            <SectionHeader
              title="760.03 — Nakliye"
              extra={<><div>{NAKLIYE.headerNote}</div><div>{fmtUsd(NAKLIYE.yillikToplamUsd)} yıllık toplam</div></>}
            />
            <Note>Aylık tutarlar, o ayın yurt bazlı export miktarı (kg) üzerinden hesaplanır — Satış sayfasındaki dağılım verisinden gelir.</Note>
            <CountryTable
              kazakistan={NAKLIYE.kazakistan} rusya={NAKLIYE.rusya} toplamLabel="Nakliye Toplamı"
              toplamMonthly={NAKLIYE.toplamMonthly} toplamUsd={NAKLIYE.toplamUsd}
            />
          </SeraCard>

          {/* 760.04 — Daşary ýurt gümrükleme */}
          <SeraCard>
            <SectionHeader
              title="760.04 — Daşary ýurt gümrükleme çykdajylary"
              extra={<><div>{DASARY_GUMRUKLEME.headerNote}</div><div>{fmtUsd(DASARY_GUMRUKLEME.yillikToplamUsd)} yıllık toplam</div></>}
            />
            <Note>Aylık tutarlar, o ayın yurt bazlı export miktarı (kg) üzerinden hesaplanır — Satış sayfasındaki dağılım verisinden gelir.</Note>
            <CountryTable
              kazakistan={DASARY_GUMRUKLEME.kazakistan} rusya={DASARY_GUMRUKLEME.rusya} toplamLabel="Toplam"
              toplamMonthly={DASARY_GUMRUKLEME.toplamMonthly} toplamUsd={DASARY_GUMRUKLEME.toplamUsd}
            />
          </SeraCard>

          {/* 760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar */}
          <SeraCard>
            <SectionHeader title="760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar" extra={`${fmtUsd(SATYS_ILISIKLI_TOPLAM.toplam)} yıllık toplam`} />
            <Note>Aylık tutarlar, o ayın yurt bazlı export miktarı (kg/tır) üzerinden hesaplanır — Satış sayfasındaki dağılım verisinden gelir. İşgärler kalemi Personel sayfasından otomatik çekilir.</Note>
            <SalesRelatedTable />
          </SeraCard>

          {/* Monthly summary */}
          <SeraCard title={`Aylık Toplam Özeti — ${selectedProductName}`}>
            <SeraMatrixTable headers={['Grup', ...MONTHS_TR, 'Toplam']} rows={ozetRows} footer={ozetFooter} minWidth={1500} />
          </SeraCard>
        </>
      )}
    </div>
  );
}
