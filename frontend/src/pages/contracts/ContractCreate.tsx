import { Modal, Form, Input, InputNumber, DatePicker, Select, Row, Col } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateContract } from '@/hooks/useContracts';
import { ExportFirmSelect } from '@/components/ExportFirmSelect';
import { ImportFirmSelect } from '@/components/ImportFirmSelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import type { IContractCreatePayload } from '@/types/contract';

// ─── Incoterm options (standard trade terms) ─────────────────────────────────

const INCOTERM_OPTIONS = ['FCA', 'CIP', 'DAP', 'CIF', 'FOB', 'EXW', 'DDP', 'DAT'].map((v) => ({
  value: v,
  label: v,
}));

// ─── Form shape ───────────────────────────────────────────────────────────────

interface IFormValues {
  contract_number?: string;
  export_firm: number;
  import_firm: number;
  incoterm: string;
  planned_trucks: number;
  planned_quantity_kg: number;
  planned_amount_usd: number;
  start_date: dayjs.Dayjs;
  end_date?: dayjs.Dayjs | null;
  customer?: number | null;
  contract_type?: string | null;
  passport_sdelka?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface IContractCreateProps {
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContractCreate({ open, onClose }: IContractCreateProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();
  const createMutation = useCreateContract();

  const handleSubmit = async () => {
    let values: IFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design shows per-field errors inline
    }

    const payload: IContractCreatePayload = {
      export_firm: values.export_firm,
      import_firm: values.import_firm,
      incoterm: values.incoterm,
      planned_trucks: values.planned_trucks,
      planned_quantity_kg: values.planned_quantity_kg,
      planned_amount_usd: values.planned_amount_usd,
      start_date: values.start_date.format('YYYY-MM-DD'),
      end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : null,
      customer: values.customer ?? null,
    };
    const trimmedNumber = values.contract_number?.trim();
    if (trimmedNumber) {
      payload.contract_number = trimmedNumber;
    }
    const trimmedType = values.contract_type?.trim();
    if (trimmedType) {
      payload.contract_type = trimmedType;
    }
    const trimmedPassport = values.passport_sdelka?.trim();
    if (trimmedPassport) {
      payload.passport_sdelka = trimmedPassport;
    }

    try {
      await createMutation.mutateAsync(payload);
      toast.success(t('contracts.create.toast.created'));
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      // DRF field-level errors: { field: ['msg'] }
      const apiError = err as { response?: { data?: Record<string, unknown> } };
      const errorData = apiError?.response?.data;
      if (errorData && typeof errorData === 'object') {
        const fieldErrors = Object.entries(errorData).map(([field, messages]) => ({
          name: field as keyof IFormValues,
          errors: Array.isArray(messages) ? messages.map(String) : [String(messages)],
        }));
        form.setFields(fieldErrors);
      } else {
        toast.error(t('contracts.create.toast.error'));
      }
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title={t('contracts.create.title')}
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText={t('contracts.create.submit')}
      cancelText={t('contracts.create.cancel')}
      confirmLoading={createMutation.isPending}
      width={640}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        size="middle"
        style={{ marginTop: 16 }}
      >
        <Row gutter={16}>
          {/* Contract number */}
          <Col span={24}>
            <Form.Item
              name="contract_number"
              label={t('contracts.create.field.contract_number')}
              extra={t('contracts.create.field.contract_number_hint')}
            >
              <Input placeholder={t('contracts.create.field.contract_number_placeholder')} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Seller (export firm) */}
          <Col span={12}>
            <Form.Item
              name="export_firm"
              label={t('contracts.create.field.export_firm')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <ExportFirmSelect />
            </Form.Item>
          </Col>

          {/* Buyer (import firm) */}
          <Col span={12}>
            <Form.Item
              name="import_firm"
              label={t('contracts.create.field.import_firm')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <ImportFirmSelect />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Incoterm — season is set server-side to the active season */}
          <Col span={12}>
            <Form.Item
              name="incoterm"
              label={t('contracts.create.field.incoterm')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Select options={INCOTERM_OPTIONS} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Planned trucks */}
          <Col span={8}>
            <Form.Item
              name="planned_trucks"
              label={t('contracts.create.field.planned_trucks')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Planned quantity (kg) */}
          <Col span={8}>
            <Form.Item
              name="planned_quantity_kg"
              label={t('contracts.create.field.planned_quantity_kg')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Planned amount (USD) */}
          <Col span={8}>
            <Form.Item
              name="planned_amount_usd"
              label={t('contracts.create.field.planned_amount_usd')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="$" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Start date */}
          <Col span={12}>
            <Form.Item
              name="start_date"
              label={t('contracts.create.field.start_date')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* End date (optional) */}
          <Col span={12}>
            <Form.Item
              name="end_date"
              label={t('contracts.create.field.end_date')}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Customer (optional) */}
          <Col span={12}>
            <Form.Item
              name="customer"
              label={t('contracts.create.field.customer')}
            >
              <CustomerSelect />
            </Form.Item>
          </Col>

          {/* Contract type */}
          <Col span={12}>
            <Form.Item
              name="contract_type"
              label={t('contracts.create.field.contract_type')}
              initialValue="FRAMEWORK"
            >
              <Select
                options={[
                  { value: 'FRAMEWORK', label: t('contracts.type.framework') },
                  { value: 'ONE_TIME', label: t('contracts.type.one_time') },
                ]}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Deal passport — framework only (one-time has none) */}
          <Col span={12}>
            <Form.Item
              name="passport_sdelka"
              label={t('contracts.create.field.passport_sdelka')}
              extra={t('contracts.create.field.passport_sdelka_hint')}
            >
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
