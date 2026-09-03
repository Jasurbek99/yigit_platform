import { Form, Input, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAdminImportFirms,
  useAdminUsers,
  useCities,
  useCountries,
  useCreateCustomer,
} from '@/hooks/useAdmin';
import type { ICustomer } from '@/types';

interface ICustomerCreateModalProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  /** Fires with the new customer's id so the caller can select it. */
  readonly onCreated: (customer: ICustomer) => void;
}

interface ICustomerFormValues {
  name: string;
  phone?: string;
  default_country?: number;
  default_city?: number;
  import_firms?: number[];
  sales_rep?: number;
}

/**
 * Create a customer without leaving the Sheet.
 *
 * Same field set as Admin › Customers, minus `is_active` (a brand-new customer is
 * always active). Gated by the caller — the POST is enforced server-side by
 * `REFERENCE_DATA_WRITE`, which `canWriteReferenceData` mirrors.
 */
export function CustomerCreateModal({ open, onCancel, onCreated }: ICustomerCreateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ICustomerFormValues>();
  const watchedCountry = Form.useWatch('default_country', form);

  const { data: countries = [] } = useCountries();
  const { data: cities = [] } = useCities(watchedCountry ?? null);
  const { data: importFirms = [] } = useAdminImportFirms();
  const { data: allUsers = [] } = useAdminUsers();

  const createCustomer = useCreateCustomer({
    onError: (err) => {
      const detail = (err as { response?: { data?: Record<string, string[]> } }).response?.data;
      toast.error(detail?.name?.[0] ?? t('customers_admin.toast_error'));
    },
  });

  const countryOptions = countries.map((c) => ({ value: c.id, label: c.name_en || c.name_tk }));
  const cityOptions = cities.map((c) => ({ value: c.id, label: c.name }));
  const importFirmOptions = importFirms.map((f) => ({
    value: f.id,
    label: f.name_short || f.name_company,
  }));
  // GET /export/admin/users/ admits only admin / export_manager / superuser
  // (UserManagementViewSet._ADMIN_MANAGER) plus delegated managers, so a
  // `director` — who passes this modal's own gate — gets nothing back. Hide the
  // field rather than offer an empty dropdown; the sales rep is assignable in
  // Admin › Customers, and this stays correct without copying that role list here.
  const salesRepOptions = allUsers
    .filter((u) => u.role === 'sales_rep')
    .map((u) => ({
      value: u.id,
      label: u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.username,
    }));

  function handleSubmit(values: ICustomerFormValues): void {
    createCustomer.mutate(values, {
      onSuccess: (response) => {
        toast.success(t('customers_admin.toast_created'));
        form.resetFields();
        onCreated(response.data);
      },
    });
  }

  return (
    <Modal
      title={t('customers_admin.add')}
      open={open}
      onCancel={() => { form.resetFields(); onCancel(); }}
      onOk={() => form.submit()}
      confirmLoading={createCustomer.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="name"
          label={t('customers_admin.name')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="phone" label={t('customers_admin.phone')}>
          <Input />
        </Form.Item>
        <Form.Item name="default_country" label={t('customers_admin.country')}>
          <Select
            options={countryOptions}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('customers_admin.country_placeholder')}
            onChange={() => form.setFieldValue('default_city', undefined)}
          />
        </Form.Item>
        <Form.Item name="default_city" label={t('customers_admin.city')}>
          <Select
            options={cityOptions}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('customers_admin.city_placeholder')}
            disabled={!watchedCountry}
          />
        </Form.Item>
        <Form.Item name="import_firms" label={t('customers_admin.import_firms')}>
          <Select
            mode="multiple"
            options={importFirmOptions}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('customers_admin.import_firms_placeholder')}
          />
        </Form.Item>
        {salesRepOptions.length > 0 && (
          <Form.Item name="sales_rep" label={t('customers_admin.col_sales_rep')}>
            <Select
              options={salesRepOptions}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('customers_admin.sales_rep_placeholder')}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
