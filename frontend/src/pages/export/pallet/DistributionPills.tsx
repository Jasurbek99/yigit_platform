import { Flex, Tag } from 'antd';
import { computeNet, type IEditableRow } from './palletHelpers';

interface IDistributionPillsProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
}

export function DistributionPills({ rows, crateWeightMap }: IDistributionPillsProps) {
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
