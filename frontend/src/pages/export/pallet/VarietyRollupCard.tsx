import { useMemo, useState } from 'react';
import { Button, Card, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { VarietySelect } from '@/components/VarietySelect';
import { computeNet, type IEditableRow } from './palletHelpers';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IVarietyRollupCardProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
  shipmentId: number;
}

export function VarietyRollupCard({ rows, crateWeightMap, shipmentId }: IVarietyRollupCardProps) {
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
        <div>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 8 }}>
            {t('pallet.rollup_computed')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {computed.map((v) => (
              <div
                key={v.id}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: COLORS.bgGreen, borderRadius: 6, border: '1px solid #b7eb8f' }}
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
        <div>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 8 }}>
            {t('pallet.rollup_override')}
          </div>
          <div style={{ padding: 12, background: COLORS.bgLayout, borderRadius: 8, border: '1px solid #f0f0f0' }}>
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
            <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{t('pallet.confidence_high')}</Text>
            <Tag color="success">✓</Tag>
          </div>
        </div>
      </div>
    </Card>
  );
}
