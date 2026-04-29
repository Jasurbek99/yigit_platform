import { useEffect, useState } from 'react';
import { Drawer, Form, DatePicker, Select, Space, Button, Switch } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { CountrySelect } from '@/components/CountrySelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { useAdminFirms } from '@/hooks/useAdmin';

interface IFilterValues {
  country?: number | null;
  customer?: number | null;
  export_firm?: number | null;
  date_after?: string | null;
  date_before?: string | null;
  pending_my_fields?: boolean;
}

interface IShipmentFilterDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Current filter values from URL search params. */
  initial: IFilterValues;
  /** Apply chosen filters; the parent reflects them to the URL. */
  onApply: (values: IFilterValues) => void;
  /** Clear every filter. */
  onClear: () => void;
}

const { RangePicker } = DatePicker;

/**
 * Right-side advanced filter panel for the Shipments list.
 * State is local; values are applied to the URL when the user clicks Apply.
 */
export function ShipmentFilterDrawer({
  open,
  onClose,
  initial,
  onApply,
  onClear,
}: IShipmentFilterDrawerProps) {
  const { t } = useTranslation();
  const { data: firms = [] } = useAdminFirms();
  const [values, setValues] = useState<IFilterValues>(initial);

  // Reset local state when the drawer opens with fresh initial values
  useEffect(() => {
    if (open) setValues(initial);
  }, [open, initial]);

  function update<K extends keyof IFilterValues>(key: K, value: IFilterValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const dateRange: [dayjs.Dayjs | null, dayjs.Dayjs | null] = [
    values.date_after ? dayjs(values.date_after) : null,
    values.date_before ? dayjs(values.date_before) : null,
  ];

  const firmOptions = firms
    .filter((f) => f.is_active)
    .map((f) => ({ value: f.id, label: `${f.code} — ${f.name_en ?? f.name_tk}` }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('shipment_filter_drawer.title')}
      width={400}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button onClick={onClear}>{t('shipment_filter_drawer.clear_all')}</Button>
          <Space>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={() => onApply(values)}>
              {t('shipment_filter_drawer.apply')}
            </Button>
          </Space>
        </Space>
      }
    >
      <Form layout="vertical">
        <Form.Item label={t('shipment_filter_drawer.country')}>
          <CountrySelect
            value={values.country ?? null}
            onChange={(v) => update('country', v)}
            placeholder={t('shipment_filter_drawer.country_ph')}
          />
        </Form.Item>
        <Form.Item label={t('shipment_filter_drawer.customer')}>
          <CustomerSelect
            value={values.customer ?? null}
            onChange={(v) => update('customer', v)}
            placeholder={t('shipment_filter_drawer.customer_ph')}
          />
        </Form.Item>
        <Form.Item label={t('shipment_filter_drawer.export_firm')}>
          <Select
            value={values.export_firm ?? undefined}
            onChange={(v) => update('export_firm', v ?? null)}
            options={firmOptions}
            placeholder={t('shipment_filter_drawer.export_firm_ph')}
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label={t('shipment_filter_drawer.date_range')}>
          <RangePicker
            value={dateRange}
            onChange={(range) => {
              update('date_after', range?.[0]?.format('YYYY-MM-DD') ?? null);
              update('date_before', range?.[1]?.format('YYYY-MM-DD') ?? null);
            }}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label={t('shipment_filter_drawer.pending_my_fields')}>
          <Switch
            checked={!!values.pending_my_fields}
            onChange={(checked) => update('pending_my_fields', checked)}
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
