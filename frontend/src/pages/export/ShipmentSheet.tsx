import { useMemo } from 'react';
import { Spin } from 'antd';
import { useShipmentSheet } from '@/hooks/useShipmentSheet';
import { useSheetStore } from '@/stores/sheetStore';
import { SheetToolbar } from '@/components/sheet/SheetToolbar';
import { SheetGrid } from '@/components/sheet/SheetGrid';
import '@/components/sheet/SheetStyles.css';

export default function ShipmentSheet() {
  const { data: shipments, isLoading } = useShipmentSheet();
  const { searchText, showGapyOnly } = useSheetStore();

  const filtered = useMemo(() => {
    if (!shipments) return [];
    let result = shipments;

    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (s) =>
          s.cargo_code.toLowerCase().includes(q) ||
          s.customer_name?.toLowerCase().includes(q),
      );
    }

    if (showGapyOnly) {
      result = result.filter((s) => s.is_gapy_satys);
    }

    return result;
  }, [shipments, searchText, showGapyOnly]);

  if (isLoading) {
    return (
      <div className="sheet-page">
        <div className="sheet-loading">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-page">
      <SheetToolbar shipmentCount={filtered.length} />
      <SheetGrid shipments={filtered} />
    </div>
  );
}
