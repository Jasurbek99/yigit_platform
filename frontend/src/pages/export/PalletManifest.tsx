import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Flex,
  InputNumber,
  Skeleton,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { usePallets, useUpsertPallets, useCloseManifest, useOverrideVarieties } from '@/hooks/usePallets';
import { useAuth } from '@/hooks/useAuth';
import { useCrateTypes } from '@/hooks/useAdmin';
import { CrateTypeSelect } from '@/components/CrateTypeSelect';
import { VarietySelect } from '@/components/VarietySelect';
import type { IPallet, IPalletUpsertRow } from '@/types';

const { Text, Title } = Typography;

// ─── Net weight formula ────────────────────────────────────────────────────

function computeNet(
  gross: number,
  crateWeightKg: number,
  crateCount: number,
  palletKg: number,
  additionsKg: number,
): number {
  return gross - crateWeightKg * crateCount - palletKg - additionsKg;
}

// ─── Stats row ─────────────────────────────────────────────────────────────

interface IManifestStatsProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
}

function ManifestStats({ rows, crateWeightMap }: IManifestStatsProps) {
  const { t } = useTranslation();

  const totals = useMemo(() => {
    let gross = 0;
    let crateTotal = 0;
    let palletExtra = 0;
    let net = 0;
    for (const r of rows) {
      const cw = crateWeightMap[r.crate_type] ?? 0;
      const rowNet = computeNet(r.gross_weight_kg, cw, r.crate_count, r.pallet_weight_kg, r.additions_kg);
      gross += r.gross_weight_kg;
      crateTotal += cw * r.crate_count;
      palletExtra += r.pallet_weight_kg + r.additions_kg;
      net += rowNet;
    }
    return { gross, crateTotal, palletExtra, net };
  }, [rows, crateWeightMap]);

  const statStyle: React.CSSProperties = {
    textAlign: 'center' as const,
    flex: 1,
    minWidth: 100,
  };

  return (
    <Flex gap={12} wrap="wrap" style={{ padding: '16px 0' }}>
      <div style={statStyle}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase' }}>{t('pallet.stat_pallets')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{rows.length}</div>
      </div>
      <div style={statStyle}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase' }}>{t('pallet.stat_gross')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{totals.gross.toLocaleString()} kg</div>
      </div>
      <div style={statStyle}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase' }}>{t('pallet.stat_crate')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{totals.crateTotal.toFixed(2)} kg</div>
      </div>
      <div style={statStyle}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase' }}>{t('pallet.stat_pallet_extra')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{totals.palletExtra.toFixed(2)} kg</div>
      </div>
      <div style={statStyle}>
        <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase' }}>{t('pallet.stat_net')}</div>
        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#52c41a' }}>{totals.net.toFixed(2)} kg</div>
      </div>
    </Flex>
  );
}

// ─── Distribution pills ────────────────────────────────────────────────────

interface IDistributionPillsProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
}

function DistributionPills({ rows, crateWeightMap }: IDistributionPillsProps) {
  const subBlockTotals: Record<string, { count: number; kg: number }> = {};
  const varietyTotals: Record<string, { count: number; name: string }> = {};

  for (const r of rows) {
    const cw = crateWeightMap[r.crate_type] ?? 0;
    const net = computeNet(r.gross_weight_kg, cw, r.crate_count, r.pallet_weight_kg, r.additions_kg);
    const sbKey = r.sub_block_code || String(r.sub_block);
    subBlockTotals[sbKey] = subBlockTotals[sbKey] ?? { count: 0, kg: 0 };
    subBlockTotals[sbKey].count++;
    subBlockTotals[sbKey].kg += net;

    const vKey = String(r.variety);
    varietyTotals[vKey] = varietyTotals[vKey] ?? { count: 0, name: r.variety_name || vKey };
    varietyTotals[vKey].count++;
  }

  return (
    <Flex gap={6} wrap="wrap" style={{ marginBottom: 8 }}>
      {Object.entries(subBlockTotals).map(([code, val]) => (
        <Tag key={code} color="purple">
          {code}: {val.count} palet · {val.kg.toFixed(0)} kg
        </Tag>
      ))}
      {Object.entries(varietyTotals).map(([id, val]) => (
        <Tag key={id} color="success">
          {val.name} {val.count}
        </Tag>
      ))}
    </Flex>
  );
}

// ─── Variety roll-up card ──────────────────────────────────────────────────

interface IVarietyRollupProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
  shipmentId: number;
}

function VarietyRollupCard({ rows, crateWeightMap, shipmentId }: IVarietyRollupProps) {
  const { t } = useTranslation();
  const overrideMutation = useOverrideVarieties(shipmentId);
  const [overrideIds, setOverrideIds] = useState<number[]>([]);

  const computed = useMemo(() => {
    const byVariety: Record<string, { id: number; name: string; pallets: number; kg: number }> = {};
    let totalNet = 0;
    for (const r of rows) {
      const cw = crateWeightMap[r.crate_type] ?? 0;
      const net = computeNet(r.gross_weight_kg, cw, r.crate_count, r.pallet_weight_kg, r.additions_kg);
      totalNet += net;
      const key = String(r.variety);
      byVariety[key] = byVariety[key] ?? { id: r.variety, name: r.variety_name || key, pallets: 0, kg: 0 };
      byVariety[key].pallets++;
      byVariety[key].kg += net;
    }
    return Object.values(byVariety)
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 4)
      .map((v) => ({ ...v, pct: totalNet > 0 ? ((v.kg / totalNet) * 100).toFixed(1) : '0' }));
  }, [rows, crateWeightMap]);

  function handleApplyOverride() {
    if (overrideIds.length === 0) return;
    overrideMutation.mutate(overrideIds, {
      onSuccess: () => toast.success(t('pallet.toast_closed')),
    });
  }

  return (
    <Card
      title={<span>{t('pallet.rollup_title')}</span>}
      style={{ marginTop: 14 }}
      size="small"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: '8px 0' }}>
        {/* Left: computed */}
        <div>
          <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 8 }}>
            {t('pallet.rollup_computed')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {computed.map((v) => (
              <div
                key={v.id}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}
              >
                <span style={{ fontWeight: 600 }}>{v.name}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#389e0d' }}>
                  {v.pallets} palet · {v.kg.toFixed(0)} kg · {v.pct}%
                </span>
              </div>
            ))}
            {computed.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>{t('pallet.empty_state')}</Text>
            )}
          </div>
        </div>
        {/* Right: override */}
        <div>
          <div style={{ fontSize: 11, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 8 }}>
            {t('pallet.rollup_override')}
          </div>
          <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
            <VarietySelect
              value={overrideIds[0] ?? null}
              onChange={(v) => setOverrideIds(v != null ? [v] : [])}
              placeholder={t('pallet.rollup_override')}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <Button
              size="small"
              type="primary"
              loading={overrideMutation.isPending}
              onClick={handleApplyOverride}
              disabled={overrideIds.length === 0}
            >
              {t('pallet.rollup_apply_override')}
            </Button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{t('pallet.confidence_high')}</Text>
            <Tag color="success">✓</Tag>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Editable row type ─────────────────────────────────────────────────────
// Uses number (not number | string) for weight fields to keep computeNet typesafe.

interface IEditableRow {
  key: number;
  pallet_number: number;
  crate_type: number;
  crate_type_name: string;
  crate_count: number;
  gross_weight_kg: number;
  pallet_weight_kg: number;
  additions_kg: number;
  variety: number;
  variety_name: string;
  sub_block: number;
  sub_block_code: string;
  loaded_at?: string;
}

function palletToEditableRow(p: IPallet): IEditableRow {
  return {
    key:              p.pallet_number,
    pallet_number:    p.pallet_number,
    crate_type:       p.crate_type,
    crate_type_name:  p.crate_type_name,
    crate_count:      p.crate_count,
    gross_weight_kg:  Number(p.gross_weight_kg),
    pallet_weight_kg: Number(p.pallet_weight_kg),
    additions_kg:     Number(p.additions_kg),
    variety:          p.variety,
    variety_name:     p.variety_name,
    sub_block:        p.sub_block,
    sub_block_code:   p.sub_block_code,
    loaded_at:        p.loaded_at,
  };
}

// ─── Pallet table ──────────────────────────────────────────────────────────

interface IPalletTableProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
  crateTypeOptions: { id: number; name: string; weight_kg: string }[];
  onChangeRow: (key: number, field: keyof IEditableRow, value: unknown) => void;
}

function PalletTable({ rows, crateWeightMap, onChangeRow }: IPalletTableProps) {
  const { t } = useTranslation();

  const columns: TableColumnsType<IEditableRow> = [
    {
      title: t('pallet.col_number'),
      dataIndex: 'pallet_number',
      width: 56,
      fixed: 'left' as const,
      render: (v: number) => <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: t('pallet.col_crate_type'),
      dataIndex: 'crate_type',
      width: 190,
      render: (v: number, record) => (
        <CrateTypeSelect
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'crate_type', newVal)}
          size="small"
          style={{ width: 175 }}
        />
      ),
    },
    {
      title: t('pallet.col_gross'),
      dataIndex: 'gross_weight_kg',
      width: 100,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'gross_weight_kg', newVal ?? 0)}
          size="small"
          style={{ width: 88 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_count'),
      dataIndex: 'crate_count',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'crate_count', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={0}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_crate_weight'),
      dataIndex: 'crate_type',
      key: 'crate_weight_auto',
      width: 80,
      render: (v: number, record) => {
        const cw = crateWeightMap[v] ?? 0;
        return (
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8c8c8c' }}>
            {(cw * record.crate_count).toFixed(2)}
          </span>
        );
      },
    },
    {
      title: t('pallet.col_pallet_kg'),
      dataIndex: 'pallet_weight_kg',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'pallet_weight_kg', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_additions'),
      dataIndex: 'additions_kg',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'additions_kg', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_net'),
      key: 'net',
      width: 90,
      render: (_: unknown, record) => {
        const cw = crateWeightMap[record.crate_type] ?? 0;
        const net = computeNet(
          Number(record.gross_weight_kg),
          cw,
          record.crate_count,
          Number(record.pallet_weight_kg),
          Number(record.additions_kg),
        );
        return (
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#389e0d' }}>
            {net.toFixed(2)}
          </span>
        );
      },
    },
    {
      title: t('pallet.col_variety'),
      dataIndex: 'variety',
      width: 160,
      render: (v: number, record) => (
        <VarietySelect
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'variety', newVal)}
          size="small"
          style={{ width: 148 }}
        />
      ),
    },
    {
      title: t('pallet.col_sub_block'),
      dataIndex: 'sub_block_code',
      width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
  ];

  return (
    <Table<IEditableRow>
      dataSource={rows}
      columns={columns}
      rowKey="key"
      size="small"
      pagination={false}
      scroll={{ x: 1050 }}
      bordered
    />
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function PalletManifest() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const shipmentId = id ? parseInt(id, 10) : null;

  const { data: shipment, isLoading: shipmentLoading } = useShipmentDetail(id);
  const { data: palletsRaw = [], isLoading: palletsLoading } = usePallets(shipmentId);
  const { data: crateTypes = [] } = useCrateTypes();
  useAuth(); // ensures auth guard is active

  const upsertMutation = useUpsertPallets(shipmentId!);
  const closeMutation = useCloseManifest(shipmentId!);

  // Build a crate-weight lookup map: crateTypeId → weight_kg (number)
  const crateWeightMap = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const ct of crateTypes) {
      map[ct.id] = parseFloat(ct.weight_kg);
    }
    return map;
  }, [crateTypes]);

  // Local editable state initialised from server data
  const [rows, setRows] = useState<IEditableRow[]>([]);
  const [initialised, setInitialised] = useState(false);

  // Sync server pallets → local rows (once on load)
  if (!initialised && palletsRaw.length > 0) {
    setRows(palletsRaw.map(palletToEditableRow));
    setInitialised(true);
  }

  function handleAddPallet() {
    const nextNum = rows.length > 0 ? Math.max(...rows.map((r) => r.pallet_number)) + 1 : 1;
    const firstActiveCrate = crateTypes.find((ct) => ct.is_active);
    const newRow: IEditableRow = {
      key: nextNum,
      pallet_number: nextNum,
      crate_type: firstActiveCrate?.id ?? 1,
      crate_type_name: firstActiveCrate?.name ?? '',
      crate_count: 64,
      gross_weight_kg: 0,
      pallet_weight_kg: 7,
      additions_kg: 4,
      variety: 0,
      variety_name: '',
      sub_block: 0,
      sub_block_code: '',
    };
    setRows((prev) => [...prev, newRow]);
  }

  function handleChangeRow(key: number, field: keyof IEditableRow, value: unknown) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }

  function handleSave() {
    const payload: IPalletUpsertRow[] = rows.map((r) => ({
      pallet_number: r.pallet_number,
      crate_type: r.crate_type,
      crate_count: r.crate_count,
      gross_weight_kg: r.gross_weight_kg,
      pallet_weight_kg: r.pallet_weight_kg,
      additions_kg: r.additions_kg,
      variety: r.variety,
      sub_block: r.sub_block,
      loaded_at: r.loaded_at,
    }));
    upsertMutation.mutate(payload, {
      onSuccess: () => toast.success(t('pallet.toast_saved')),
    });
  }

  function handleCloseManifest() {
    closeMutation.mutate(undefined, {
      onSuccess: () => toast.success(t('pallet.toast_closed')),
    });
  }

  function handleLogoExport() {
    // TODO: Logo Tiger ERP export — deferred. See Kaka_Findings_v2.md §4 line 134.
    toast.info(t('pallet.toast_logo_todo'));
  }

  if (shipmentLoading || palletsLoading) {
    return <div style={{ padding: 24 }}><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }

  if (!shipment) {
    return <Alert type="error" message={t('pallet.title')} style={{ margin: 24 }} />;
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: 0 }}>
          {t('pallet.title')} — <span style={{ fontFamily: 'monospace' }}>{shipment.cargo_code}</span>
        </Title>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button onClick={handleLogoExport}>{t('pallet.btn_logo_export')}</Button>
          <Button
            type="primary"
            danger={false}
            loading={closeMutation.isPending}
            disabled={rows.length === 0}
            onClick={handleCloseManifest}
          >
            {t('pallet.btn_close_manifest')}
          </Button>
        </div>
      </Flex>

      {/* Info banner */}
      <Alert
        type="info"
        showIcon
        message={t('pallet.banner_source_of_truth')}
        style={{ marginBottom: 16 }}
      />

      {/* Stats + distribution */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 12 }}>
          <ManifestStats rows={rows} crateWeightMap={crateWeightMap} />
        </div>
        <DistributionPills rows={rows} crateWeightMap={crateWeightMap} />
      </Card>

      {/* Pallet table */}
      <Card
        title={
          <span>
            {t('pallet.stat_pallets')} ({rows.length})
          </span>
        }
        extra={
          <Flex gap={8}>
            <Button size="small" onClick={handleAddPallet}>{t('pallet.btn_add_pallet')}</Button>
            <Button
              size="small"
              type="primary"
              loading={upsertMutation.isPending}
              onClick={handleSave}
            >
              {t('pallet.btn_save')}
            </Button>
          </Flex>
        }
      >
        {rows.length === 0 ? (
          <Text type="secondary">{t('pallet.empty_state')}</Text>
        ) : (
          <PalletTable
            rows={rows}
            crateWeightMap={crateWeightMap}
            crateTypeOptions={crateTypes}
            onChangeRow={handleChangeRow}
          />
        )}
      </Card>

      {/* Variety roll-up */}
      {shipmentId != null && (
        <VarietyRollupCard
          rows={rows}
          crateWeightMap={crateWeightMap}
          shipmentId={shipmentId}
        />
      )}
    </div>
  );
}
