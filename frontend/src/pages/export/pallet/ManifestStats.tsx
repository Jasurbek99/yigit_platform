import { useMemo } from 'react';
import { Flex } from 'antd';
import { useTranslation } from 'react-i18next';
import { computeNet, type IEditableRow } from './palletHelpers';

interface IManifestStatsProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
}

export function ManifestStats({ rows, crateWeightMap }: IManifestStatsProps) {
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
