import { useState } from 'react';
import { Button, Input, InputNumber, Select } from 'antd';
import {
  IconPackage, IconPlus, IconMessageCircle2, IconChevronDown, IconChevronUp,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraStatCard } from '../../components/SeraStatCard';
import { SeraBlockSelector, SeraMonthSelector } from '../../components/SeraChipSelector';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtUsd } from '../../seraTheme';
import { SERA_BLOCKS_BY_GROUP, MONTHS_TR } from '../../mock/seraData';
import {
  CONSUMABLE_PRODUCT_TYPES, CONSUMABLE_UNITS, DEFAULT_CONSUMABLE_MATERIALS,
  GIDER_AYI_BLOCK_OVERRIDES, type ConsumableMaterial,
} from '../../mock/sarfMalzemeleri';

const ALL_BLOCK_IDS = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks.map((b) => b.id));

// ─── Small local building blocks (not shared — page-specific) ────────────
function ProductChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
        border: `1px solid ${active ? SERA.green : SERA.line}`,
        background: active ? SERA.green : SERA.card,
        color: active ? '#fff' : SERA.ink,
      }}
    >
      {label}
    </button>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 4px', marginRight: 24, border: 'none', background: 'none', cursor: 'pointer',
        fontWeight: active ? 700 : 500, fontSize: 14,
        color: active ? SERA.green : SERA.sub,
        borderBottom: active ? `2px solid ${SERA.green}` : '2px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

export default function SarfMalzemeleri() {
  const [year] = useState(2026);
  const [productTypes, setProductTypes] = useState<string[]>([...CONSUMABLE_PRODUCT_TYPES]);
  const [selectedProduct, setSelectedProduct] = useState('Domates');
  const [newProductName, setNewProductName] = useState('');

  const [activeTab, setActiveTab] = useState<'miktar' | 'fiyat'>('miktar');
  const [faqOpen, setFaqOpen] = useState(false);

  const [blocks, setBlocks] = useState<string[]>([...ALL_BLOCK_IDS]);
  const [months, setMonths] = useState<number[]>([0]);

  const [materials, setMaterials] = useState<ConsumableMaterial[]>([...DEFAULT_CONSUMABLE_MATERIALS]);
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newMaterialUnit, setNewMaterialUnit] = useState<string>(CONSUMABLE_UNITS[0]);

  const [giderAy, setGiderAy] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    DEFAULT_CONSUMABLE_MATERIALS.forEach((m) => {
      const row: Record<string, number> = {};
      ALL_BLOCK_IDS.forEach((blockId) => {
        row[blockId] = GIDER_AYI_BLOCK_OVERRIDES[m.key]?.[blockId] ?? m.defaultGiderAyIdx;
      });
      init[m.key] = row;
    });
    return init;
  });

  const selectedBlocks = SERA_BLOCKS_BY_GROUP.flatMap((g) => g.blocks).filter((b) => blocks.includes(b.id));

  const handleAddProduct = () => {
    const name = newProductName.trim();
    if (!name || productTypes.includes(name)) return;
    setProductTypes([...productTypes, name]);
    setNewProductName('');
  };

  const handleAddMaterial = () => {
    const name = newMaterialName.trim();
    if (!name) return;
    const key = `${name.toLowerCase()}-${Date.now()}`;
    setMaterials([...materials, { key, name, unit: newMaterialUnit, standardQty: 0, defaultGiderAyIdx: 0, unitPriceUsd: 0 }]);
    setGiderAy((prev) => {
      const row: Record<string, number> = {};
      ALL_BLOCK_IDS.forEach((blockId) => { row[blockId] = 0; });
      return { ...prev, [key]: row };
    });
    setNewMaterialName('');
  };

  const setStandardQty = (key: string, value: number | null) => {
    setMaterials((prev) => prev.map((m) => (m.key === key ? { ...m, standardQty: value ?? 0 } : m)));
  };
  const setUnitPrice = (key: string, value: number | null) => {
    setMaterials((prev) => prev.map((m) => (m.key === key ? { ...m, unitPriceUsd: value ?? 0 } : m)));
  };
  const setGiderAyCell = (materialKey: string, blockId: string, monthIdx: number) => {
    setGiderAy((prev) => ({ ...prev, [materialKey]: { ...prev[materialKey], [blockId]: monthIdx } }));
  };

  // İhtiyaç is 0 for every material in this prototype (no Domates area is
  // flagged on the mock blocks) — mirrors the source screenshot exactly.
  const needFor = (): number => 0;

  // ─── Tab 1: Standart Oran & İhtiyaç ─────────────────────────────────────
  const qtyRows: MatrixRow[] = materials.map((m) => ({
    label: m.name,
    cells: [
      <InputNumber key="std" size="small" min={0} value={m.standardQty} onChange={(v) => setStandardQty(m.key, v)} style={{ width: 90 }} />,
      `${fmtNum(needFor())} ${m.unit}`,
    ],
  }));

  // ─── Tab 1: Blok Başına Gider Ayı ───────────────────────────────────────
  const giderAyHeaders = ['Malzeme', ...selectedBlocks.map((b) => b.name)];
  const giderAyRows: MatrixRow[] = materials.map((m) => ({
    label: m.name,
    cells: selectedBlocks.map((b) => (
      <Select
        key={b.id}
        size="small"
        value={giderAy[m.key]?.[b.id] ?? m.defaultGiderAyIdx}
        onChange={(v) => setGiderAyCell(m.key, b.id, v)}
        style={{ width: 96 }}
        options={MONTHS_TR.map((mn, i) => ({ value: i, label: mn }))}
      />
    )),
  }));

  // ─── Tab 1: Ay Bazında İhtiyaç ──────────────────────────────────────────
  const selectedMonthNames = months.map((i) => MONTHS_TR[i]);
  const needByMonthHeaders = ['Malzeme', ...selectedMonthNames];
  const needByMonthRows: MatrixRow[] = materials.map((m) => ({
    label: `${m.name} (${m.unit})`,
    cells: months.map(() => fmtNum(needFor())),
  }));

  // ─── Tab 2: Birim Fiyat & Tutar ─────────────────────────────────────────
  const priceRows: MatrixRow[] = materials.map((m) => ({
    label: m.name,
    cells: [
      m.unit,
      <InputNumber key="price" size="small" min={0} value={m.unitPriceUsd} onChange={(v) => setUnitPrice(m.key, v)} style={{ width: 90 }} />,
      fmtUsd(m.unitPriceUsd * needFor()),
    ],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconPackage size={22} />}
        title="Sarf Malzemeleri"
        subtitle="Tohum, kokopeat, kübik, ilaç vb. — ürün türüne göre miktar ve maliyet takibi"
        accent="#7c3aed"
        accentDark="#5b21b6"
        year={year}
      />

      {/* FAQ collapsible */}
      <div
        style={{
          background: SERA.greenSoft, border: `1px solid ${SERA.line}`, borderRadius: 12,
          padding: '12px 16px', cursor: 'pointer',
        }}
        onClick={() => setFaqOpen(!faqOpen)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: SERA.green, fontWeight: 600, fontSize: 13 }}>
            <IconMessageCircle2 size={17} /> Sarf Malzemeleri hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
          </span>
          {faqOpen ? <IconChevronUp size={16} color={SERA.green} /> : <IconChevronDown size={16} color={SERA.green} />}
        </div>
        {faqOpen && (
          <div style={{ marginTop: 10, fontSize: 13, color: SERA.sub }}>
            Her ürün türünün kendi standart oranı ve birim fiyatı vardır. İhtiyaç, seçili bloklardan aktif ürün
            türünü yetiştirenlerin toplam alanı (GA) × standart oran olarak hesaplanır. Blok Başına Gider Ayı
            tablosu, malzemenin hangi blokta hangi ayda giderleşeceğini belirler.
          </div>
        )}
      </div>

      {/* Ürün Türü */}
      <SeraCard title="Ürün Türü">
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Standart oran ve birim fiyat her ürün türü için ayrı tutulur. Silme/yeniden adlandırma için Satış sayfasını kullanın.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {productTypes.map((p) => (
            <ProductChip key={p} label={p} active={p === selectedProduct} onClick={() => setSelectedProduct(p)} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="Yeni ürün türü (ör. Salatalık)"
            value={newProductName}
            onChange={(e) => setNewProductName(e.target.value)}
            onPressEnter={handleAddProduct}
            style={{ maxWidth: 320 }}
          />
          <Button type="primary" icon={<IconPlus size={14} />} onClick={handleAddProduct} style={{ background: SERA.greenDark }}>
            Ekle
          </Button>
        </div>
      </SeraCard>

      {/* Tabs */}
      <div style={{ borderBottom: `1px solid ${SERA.line}` }}>
        <TabButton label="Miktar (Standart & İhtiyaç)" active={activeTab === 'miktar'} onClick={() => setActiveTab('miktar')} />
        <TabButton label="Birim Fiyat & Tutar" active={activeTab === 'fiyat'} onClick={() => setActiveTab('fiyat')} />
      </div>

      <SeraBlockSelector selected={blocks} onChange={setBlocks} title="Blok Seçimi (birden fazla)" />
      <SeraMonthSelector selected={months} onChange={setMonths} title="Ay Seçimi (birleştirilebilir)" />

      {/* Sarf Malzemesi Ekle */}
      <SeraCard title="Sarf Malzemesi Ekle">
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: -8, marginBottom: 12 }}>
          Listede olmayan bir kalem ekleyin (ör. fide kabı, ip, askı vb.). Tüm ürün türleri için 0 olarak eklenir;
          her ürünün kendi standart oranını ve birim fiyatını ayrı ayrı girebilirsiniz.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Input
            placeholder="Yeni malzeme adı (ör. Fide Kabı)"
            value={newMaterialName}
            onChange={(e) => setNewMaterialName(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <Select value={newMaterialUnit} onChange={setNewMaterialUnit} style={{ width: 110 }} options={CONSUMABLE_UNITS.map((u) => ({ value: u, label: u }))} />
          <Button type="primary" icon={<IconPlus size={14} />} onClick={handleAddMaterial} style={{ background: SERA.greenDark }}>
            Ekle
          </Button>
        </div>
      </SeraCard>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <SeraStatCard label="Seçili Blok" value={blocks.length} />
        <SeraStatCard label="Seçili Ay" value={months.length} tint="#eef2ff" accent={SERA.blue} />
      </div>

      {activeTab === 'miktar' ? (
        <>
          <SeraCard title={`Standart Oran & İhtiyaç — ${selectedProduct}`}>
            <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
              Bu malzemeler sezonluk/tek seferlik kabul edilir: her malzemenin "Gider Ayı" sütununda seçtiğiniz ayda
              tam tutar gösterilir, diğer aylarda sıfırdır (aylık tekrar etmez).
            </div>
            <SeraMatrixTable headers={['Malzeme', 'Standart (1 GA)', 'İhtiyaç']} rows={qtyRows} minWidth={520} />
            <div style={{ fontSize: 12, color: SERA.sub, marginTop: 12 }}>
              <b>Açıklama:</b> "Standart (1 GA)" her ürün türü için ayrı tutulan bir orandır — yukarıdan ürün türünü
              değiştirdiğinizde bu oranlar ve İhtiyaç o ürüne göre güncellenir. İhtiyaç, sadece seçili bloklardan{' '}
              {selectedProduct} yetiştirenlerin toplam alanı (GA) × standart oran olarak hesaplanır.
            </div>
          </SeraCard>

          <SeraCard title="Blok Başına Gider Ayı">
            <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
              Her blok için malzemenin hangi ayda giderleşeceğini ayrı ayrı seçin. Yukarıdaki blok seçimiyle hangi
              blokların görüneceğini belirleyin.
            </div>
            <SeraMatrixTable headers={giderAyHeaders} rows={giderAyRows} numeric={false} minWidth={160 + selectedBlocks.length * 100} />
          </SeraCard>

          <SeraCard title={`Ay Bazında İhtiyaç — ${selectedProduct}`}>
            <SeraMatrixTable headers={needByMonthHeaders} rows={needByMonthRows} minWidth={320} />
          </SeraCard>
        </>
      ) : (
        <SeraCard title={`Birim Fiyat & Tutar — ${selectedProduct}`}>
          <div style={{ fontSize: 12, color: SERA.sub, marginBottom: 12 }}>
            Birim fiyat her ürün türü için ayrı tutulur. Tutar, İhtiyaç × Birim Fiyat olarak hesaplanır.
          </div>
          <SeraMatrixTable headers={['Malzeme', 'Birim', 'Birim Fiyat (USD)', 'Tutar (USD)']} rows={priceRows} minWidth={560} />
        </SeraCard>
      )}
    </div>
  );
}
