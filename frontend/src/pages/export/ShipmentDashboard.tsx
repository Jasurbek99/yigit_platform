import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useShipments } from '@/hooks/useShipments';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { ShipmentTable } from '@/components/dashboard/ShipmentTable';
import { DetailSlide } from '@/components/dashboard/DetailSlide';
import './ShipmentDashboard.css';

type FilterMode = 'all' | 'active' | 'completed';

const VALID_FILTER_MODES: FilterMode[] = ['all', 'active', 'completed'];

function isFilterMode(val: string | null): val is FilterMode {
  return VALID_FILTER_MODES.includes(val as FilterMode);
}

export default function ShipmentDashboard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawFilter = searchParams.get('filter');
  const filterMode: FilterMode = isFilterMode(rawFilter) ? rawFilter : 'all';
  const search = searchParams.get('q') ?? '';
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const { data, isLoading, isError } = useShipments({ page_size: 200 });
  const shipments = data?.results ?? [];

  const handleFilterChange = useCallback(
    (mode: FilterMode) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('filter', mode);
        return next;
      });
    },
    [setSearchParams],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set('q', value);
        } else {
          next.delete('q');
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const handleSelect = useCallback(
    (id: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('id', String(id));
        return next;
      });
    },
    [setSearchParams],
  );

  const handleClose = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('id');
      return next;
    });
  }, [setSearchParams]);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: 'calc(100vh - 64px)',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message={t('shipments.error_load')} />
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <DashboardHeader shipments={shipments} />

      <div className="dashboard-content">
        <ShipmentTable
          shipments={shipments}
          filterMode={filterMode}
          search={search}
          onFilterChange={handleFilterChange}
          onSearchChange={handleSearchChange}
          onSelect={handleSelect}
        />
      </div>

      <DetailSlide shipmentId={selectedId} onClose={handleClose} />
    </div>
  );
}
