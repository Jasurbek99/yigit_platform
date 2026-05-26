import { useMemo } from 'react';
import { Input, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ShipmentRow } from './ShipmentRow';
import type { IShipmentListItem } from '@/types';

type FilterMode = 'all' | 'active' | 'completed';

interface IShipmentTableProps {
  shipments: IShipmentListItem[];
  filterMode: FilterMode;
  search: string;
  onFilterChange: (mode: FilterMode) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: number) => void;
}

export function ShipmentTable({
  shipments,
  filterMode,
  search,
  onFilterChange,
  onSearchChange,
  onSelect,
}: IShipmentTableProps) {
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    let list = shipments;

    if (filterMode === 'active') {
      list = list.filter((s) => s.status_step < 13);
    } else if (filterMode === 'completed') {
      list = list.filter((s) => s.status_step >= 13);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.cargo_code.toLowerCase().includes(q) ||
          (s.customer_name?.toLowerCase().includes(q) ?? false) ||
          (s.country_name?.toLowerCase().includes(q) ?? false),
      );
    }

    return list;
  }, [shipments, filterMode, search]);

  const segmentOptions = [
    { label: t('dashboard.filter_all'), value: 'all' },
    { label: t('dashboard.filter_active'), value: 'active' },
    { label: t('dashboard.filter_completed'), value: 'completed' },
  ];

  return (
    <div className="dashboard-table">
      <div className="shipment-table-header">
        <Segmented
          options={segmentOptions}
          value={filterMode}
          onChange={(val) => onFilterChange(val as FilterMode)}
          size="small"
        />
        <Input
          prefix={<SearchOutlined style={{ color: '#98a2b3' }} />}
          placeholder={t('dashboard.search_ph')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          allowClear
          size="small"
          style={{ width: 240 }}
        />
        <span style={{ fontSize: 12, color: '#667085', marginLeft: 'auto' }}>
          {t('dashboard.shipments_count', { count: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: '#98a2b3',
            fontSize: 13,
          }}
        >
          {t('dashboard.no_data')}
        </div>
      ) : (
        filtered.map((shipment, index) => (
          <ShipmentRow
            key={shipment.id}
            index={index}
            shipment={shipment}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  );
}
