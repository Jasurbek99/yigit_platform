---
name: react-page
description: "Create React page components with Ant Design ProTable, role-based field visibility, and TanStack Query hooks. Use when building pages."
---

# React Page Skill (Ant Design 5 + TanStack Query)

## API hook with httpOnly cookie auth

```typescript
// hooks/useShipments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { IShipment, IShipmentDetail } from '@/types/shipment';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export const useShipments = (params?: Record<string, any>) =>
  useQuery<{ count: number; results: IShipment[] }>({
    queryKey: ['shipments', params],
    queryFn: USE_MOCK
      ? () => import('@/mock/shipments').then(m => m.mockShipmentList)
      : () => api.get('/api/v1/export/shipments/', { params }).then(r => r.data),
  });

export const useShipment = (id: number) =>
  useQuery<IShipmentDetail>({
    queryKey: ['shipment', id],
    queryFn: () => api.get(`/api/v1/export/shipments/${id}/`).then(r => r.data),
    enabled: !!id,
  });

export const useTransitionShipment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newStatus, comment }: { id: number; newStatus: string; comment?: string }) =>
      api.post(`/api/v1/export/shipments/${id}/transition/`, { new_status: newStatus, comment }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['shipment', id] });
    },
  });
};
```

Note: no `Authorization` header needed — httpOnly cookie is sent automatically by the browser.

## List page with role-based columns

```typescript
// pages/export/ShipmentList.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Tag, Switch, Space } from 'antd';
import ProTable, { ProColumns } from '@ant-design/pro-table';
import { useTranslation } from 'react-i18next';
import { useShipments } from '@/hooks/useShipments';
import { useAuthStore } from '@/stores/authStore';
import type { IShipment } from '@/types/shipment';

const ShipmentList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { editableFields } = useAuthStore();
  const [myWork, setMyWork] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({});

  const { data, isLoading } = useShipments({ ...params, my_work: myWork || undefined });

  const columns: ProColumns<IShipment>[] = [
    { title: t('export.shipment.cargoCode'), dataIndex: 'cargo_code', copyable: true },
    { title: t('export.shipment.status'), dataIndex: 'status_display',
      render: (_, r) => <Tag color={statusColor(r.status)}>{r.status_display}</Tag> },
    { title: t('export.shipment.country'), dataIndex: 'country_name' },
    { title: t('export.shipment.weightNet'), dataIndex: 'weight_net',
      render: (v) => `${Number(v).toLocaleString()} kg`, sorter: true },
    { title: t('export.shipment.departed'), dataIndex: 'departed_at',
      render: (v) => v ? dayjs(v).format('DD.MM.YY HH:mm') : '—',
      responsive: ['md'] },  // hidden on mobile
  ];

  return (
    <ProTable<IShipment>
      columns={columns}
      dataSource={data?.results}
      loading={isLoading}
      rowKey="id"
      search={{ filterType: 'light' }}
      pagination={{ total: data?.count, pageSize: 50 }}
      headerTitle={t('export.shipmentList.title')}
      toolBarRender={() => [
        <Space key="tools">
          <span>{t('common.myWork')}</span>
          <Switch checked={myWork} onChange={setMyWork} />
        </Space>,
      ]}
      onRow={(r) => ({ onClick: () => navigate(`/export/shipments/${r.id}`), style: { cursor: 'pointer' } })}
    />
  );
};

export default ShipmentList;
```

## TypeScript types matching api-contract.md

```typescript
// types/shipment.ts
export interface IShipment {
  id: number;
  cargo_code: string;
  date: string;
  status: number;
  status_display: string;
  country_name: string | null;
  customer_name: string | null;
  weight_net: number | null;
  weight_gross: number | null;
  departed_at: string | null;
  arrived_at: string | null;
  is_gapy_satys: boolean;
}

export interface IShipmentDetail extends IShipment {
  firm_splits: IFirmSplit[];
  block_sources: IBlockSource[];
  status_log: IStatusLogEntry[];
  quality: IQualityDocument | null;
  comments: IComment[];
  vehicle_condition: string | null;
  vehicle_condition_note: string | null;
  route_note: string | null;
  editable_fields: string[];
}

export interface IFirmSplit {
  export_firm_id: number;
  export_firm_name: string;
  weight_kg: number;
  amount_usd: number | null;
}

export interface IBlockSource {
  block_code: string;
  block_name: string;
  weight_kg: number;
}

export interface IStatusLogEntry {
  status_display: string;
  changed_by_name: string;
  changed_at: string;
  comment: string | null;
}

export interface IComment {
  id: number;
  user_name: string;
  role: string;
  content: string;
  parent_comment_id: number | null;
  is_system: boolean;
  created_at: string;
}
```

## Rules
- Field names match `api-contract.md` (API names, not DB columns)
- Every page: loading + error + empty states
- `responsive: ['md']` on columns not needed on mobile
- All text through `useTranslation()`
- Mock data in `mock/` for every hook
