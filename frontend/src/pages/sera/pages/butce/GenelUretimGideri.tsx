import { useState, type CSSProperties } from 'react';
import { Button, Input } from 'antd';
import {
  IconBook2, IconMessageCircle, IconChevronDown, IconPlus, IconPencil, IconTrash,
  IconArrowUp, IconArrowDown,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../../components/SeraPageHeader';
import { SeraCard } from '../../components/SeraCard';
import { SeraMatrixTable, type MatrixRow } from '../../components/SeraMatrixTable';
import { SERA, fmtNum, fmtUsd } from '../../seraTheme';
import { MONTHS_TR } from '../../mock/seraData';
import {
  GUG_PRODUCT_TYPES, GUG_GROUPS, GUG_GRAND_TOTAL,
  gugItemTotal, gugGroupTotal, gugGroupMonthlyTotals,
} from '../../mock/genelUretimGideri';

const YEAR = 2026;
type CoolMode = 'Soğutmalı' | 'Soğutmasız';

function actionBtnStyle(disabled: boolean, danger = false): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? SERA.line : danger ? SERA.neg : SERA.sub,
    padding: 2,
    display: 'flex',
  };
}

export default function GenelUretimGideri() {
  const [product, setProduct] = useState('Domates');
  const [coolMode, setCoolMode] = useState<CoolMode>('Soğutmalı');
  const [faqOpen, setFaqOpen] = useState(false);

  const tableHeaders = ['Kalem', ...MONTHS_TR, 'Toplam', ''];
  const groupMonthlySums = GUG_GROUPS.map((g) => gugGroupMonthlyTotals(g));
  const grandMonthlySums = Array.from({ length: 12 }, (_, m) =>
    groupMonthlySums.reduce((sum, months) => sum + months[m], 0),
  );

  const renderRowActions = (isFirst: boolean, isLast: boolean) => (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      <button type="button" disabled={isFirst} title="Yukarı taşı" style={actionBtnStyle(isFirst)}>
        <IconArrowUp size={14} />
      </button>
      <button type="button" disabled={isLast} title="Aşağı taşı" style={actionBtnStyle(isLast)}>
        <IconArrowDown size={14} />
      </button>
      <button type="button" title="Kalemi sil" style={actionBtnStyle(false, true)}>
        <IconTrash size={14} />
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconBook2 size={22} />}
        title="Genel Üretim Gideri"
        subtitle="730 — Soğutmalı ve soğutmasız için ayrı ayrı, 10 GA referans alanı başına aylık tutar girilir. Her bloğun gerçek alanıyla ölçeklenerek giderlere aktarılır."
        accent="#ca8a04"
        accentDark="#854d0e"
        year={YEAR}
        extra={
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Soğutmalı Yıllık Toplam (10 GA)</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUsd(GUG_GRAND_TOTAL)}</div>
          </div>
        }
      />

      {/* FAQ bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setFaqOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setFaqOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: SERA.greenSoft,
          border: `1px solid ${SERA.line}`,
          borderRadius: 10,
          padding: '10px 16px',
          cursor: 'pointer',
          color: SERA.green,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconMessageCircle size={16} /> Genel Üretim Gideri (730) hakkında soru sor — nasıl hesaplanıyor, veriler nereden geliyor?
        </span>
        <IconChevronDown size={16} style={{ transform: faqOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }} />
      </div>
      {faqOpen && (
        <div style={{ fontSize: 13, color: SERA.sub, padding: '0 4px' }}>
          730 belgili çykdajylar 3 topara bölünýär: energiýa we kommunal, remont we abatlaýyş, beýleki umumy önümçilik.
          Her toparyň 10 GA-a görä aýlyk tutary saýlanan önüm görnüşine we sowadyjy ýagdaýyna (Soğutmalı / Soğutmasız)
          baglylykda hasaplanýar.
        </div>
      )}

      {/* Product types */}
      <SeraCard
        title="Ürün Türü"
        extra={
          <Button
            type="primary"
            size="small"
            icon={<IconPlus size={14} />}
            style={{ background: SERA.green, borderColor: SERA.green }}
          >
            Ürün Ekle
          </Button>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {GUG_PRODUCT_TYPES.map((p) => {
            const active = p === product;
            return (
              <div
                key={p}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${active ? SERA.green : SERA.line}`,
                  background: active ? SERA.green : SERA.card,
                  color: active ? '#fff' : SERA.ink,
                }}
              >
                <button
                  type="button"
                  onClick={() => setProduct(p)}
                  style={{ border: 'none', background: 'transparent', color: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}
                >
                  {p}
                </button>
                <IconPencil size={13} style={{ opacity: 0.8, cursor: 'pointer' }} />
                <IconTrash size={13} style={{ opacity: 0.8, cursor: 'pointer' }} />
              </div>
            );
          })}
        </div>
      </SeraCard>

      {/* Cooled / uncooled toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 13, color: SERA.sub }}>
          {coolMode} bloklara ait 10 GA referans başına aylık gider tutarları
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type={coolMode === 'Soğutmalı' ? 'primary' : 'default'} size="small" onClick={() => setCoolMode('Soğutmalı')}>
            Soğutmalı
          </Button>
          <Button type={coolMode === 'Soğutmasız' ? 'primary' : 'default'} size="small" onClick={() => setCoolMode('Soğutmasız')}>
            Soğutmasız
          </Button>
        </div>
      </div>

      {/* Expense groups */}
      {GUG_GROUPS.map((group, gi) => {
        const groupTotal = gugGroupTotal(group);
        const monthlySums = groupMonthlySums[gi];
        const rows: MatrixRow[] = group.items.map((item, ii) => ({
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconPencil size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
              {item.label}
            </span>
          ),
          cells: [
            ...item.months.map((m) => fmtNum(m)),
            fmtUsd(gugItemTotal(item)),
            renderRowActions(ii === 0, ii === group.items.length - 1),
          ],
        }));
        const footer: MatrixRow = {
          label: 'Grup Toplamı',
          cells: [
            ...monthlySums.map((m, mi) => (mi < 6 ? fmtUsd(m) : '—')),
            fmtUsd(groupTotal),
            '',
          ],
        };
        return (
          <SeraCard
            key={group.name}
            title={group.name}
            extra={<span style={{ color: SERA.ink, fontSize: 15, fontWeight: 700 }}>{fmtUsd(groupTotal)}</span>}
          >
            <SeraMatrixTable headers={tableHeaders} rows={rows} footer={footer} minWidth={1400} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Input placeholder="Yeni kalem adı..." style={{ maxWidth: 400 }} />
              <Button>Ekle</Button>
            </div>
          </SeraCard>
        );
      })}

      {/* Monthly summary */}
      <SeraCard title={`Aylık Toplam Özeti — ${product} (${coolMode})`}>
        <SeraMatrixTable
          headers={['Grup', ...MONTHS_TR, 'Toplam']}
          rows={GUG_GROUPS.map((group, gi) => ({
            label: group.name,
            cells: [
              ...groupMonthlySums[gi].map((m, mi) => (mi < 6 ? fmtUsd(m) : '—')),
              fmtUsd(gugGroupTotal(group)),
            ],
          }))}
          footer={{
            label: '730 Genel Toplam',
            cells: [
              ...grandMonthlySums.map((m, mi) => (mi < 6 ? fmtUsd(m) : '—')),
              fmtUsd(GUG_GRAND_TOTAL),
            ],
          }}
          minWidth={1300}
        />
      </SeraCard>
    </div>
  );
}
