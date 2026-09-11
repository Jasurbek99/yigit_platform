import { Alert, Modal, Form, Input, InputNumber, DatePicker, Select, Row, Col } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateContract } from '@/hooks/useContracts';
import { ExportFirmSelect } from '@/components/ExportFirmSelect';
import { ImportFirmSelect } from '@/components/ImportFirmSelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { deriveContractPlan } from '@/utils/contractPlan';
import type { ContractPlanField } from '@/utils/contractPlan';
import type { IContractCreatePayload } from '@/types/contract';

// ─── Incoterm options (standard trade terms) ─────────────────────────────────

const INCOTERM_OPTIONS = ['FCA', 'CIP', 'DAP', 'CIF', 'FOB', 'EXW', 'DDP', 'DAT'].map((v) => ({
  value: v,
  label: v,
}));

/** The four fields deriveContractPlan() reacts to; other edits leave it alone. */
const PLAN_FIELDS: ContractPlanField[] = [
  'planned_trucks', 'planned_quantity_kg', 'price_per_kg', 'planned_amount_usd',
];

// ─── Form shape ───────────────────────────────────────────────────────────────

interface IFormValues {
  contract_number?: string;
  export_firm: number;
  import_firm: number;
  incoterm: string;
  planned_trucks: number;
  planned_quantity_kg: number;
  price_per_kg: number;
  planned_amount_usd: number;
  contract_date: dayjs.Dayjs;
  start_date: dayjs.Dayjs;
  end_date?: dayjs.Dayjs | null;
  customer?: number | null;
  contract_type?: string | null;
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
  // The type is the FIRST question, because it decides which of the rest apply.
  // A one-time contract is one export firm's share of one truck (ADR-023): it has
  // no truck count to plan and no season-long validity window, and asking for
  // those in framework language is what made this form confusing.
  const contractType = Form.useWatch('contract_type', form) ?? 'FRAMEWORK';
  const isOneTime = contractType === 'ONE_TIME';

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
      // One truck by definition, and the field is not shown for it.
      planned_trucks: isOneTime ? 1 : values.planned_trucks,
      planned_quantity_kg: values.planned_quantity_kg,
      price_per_kg: values.price_per_kg,
      planned_amount_usd: values.planned_amount_usd,
      contract_date: values.contract_date.format('YYYY-MM-DD'),
      start_date: values.start_date.format('YYYY-MM-DD'),
      end_date: isOneTime || !values.end_date ? null : values.end_date.format('YYYY-MM-DD'),
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

  /**
   * Keep trucks ⇄ quantity ⇄ amount consistent as the user types. The rule lives
   * in utils/contractPlan so the edit modal on the detail page applies exactly
   * the same one — two copies would compute different totals for one contract.
   */
  const handleValuesChange = (changed: Partial<IFormValues>) => {
    if ('contract_type' in changed) {
      // Clear the plan on a type switch. The two types mean different things by
      // "quantity": a framework plan is truckloads over a season, a one-time
      // contract is one firm's share of one truck. Carrying 36 200 kg across the
      // switch would leave a truckload sitting under a label that now reads
      // "this export firm's share" — a wrong number, silently saved, on a
      // document that goes to a bank. Cheaper to retype than to catch later.
      form.setFieldsValue({
        planned_trucks: undefined,
        planned_quantity_kg: undefined,
        planned_amount_usd: undefined,
      });
      return;
    }
    const edited = Object.keys(changed)[0] as ContractPlanField | undefined;
    if (!edited || !PLAN_FIELDS.includes(edited)) return;
    form.setFieldsValue(
      deriveContractPlan(form.getFieldsValue(), edited, { linkTrucks: !isOneTime }),
    );
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
        onValuesChange={handleValuesChange}
      >
        <Row gutter={16}>
          {/* Contract type — asked FIRST: it decides which fields below apply. */}
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
          <Col span={24}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t(
                isOneTime
                  ? 'contracts.create.type_hint.one_time'
                  : 'contracts.create.type_hint.framework',
              )}
            />
          </Col>
        </Row>

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
              initialValue="FCA"
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Select options={INCOTERM_OPTIONS} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Planned trucks — framework only. A one-time contract is one truck by
              definition, so asking for a count is the framework question that made
              this form confusing; the payload sends 1. */}
          {!isOneTime && (
            <Col span={6}>
              <Form.Item
                name="planned_trucks"
                label={t('contracts.create.field.planned_trucks')}
                extra={t('contracts.create.field.planned_trucks_hint')}
                rules={[{ required: true, message: t('common.required') }]}
              >
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}

          {/* Quantity — a season's plan for a framework contract, one export
              firm's share of one truck for a one-time one (ADR-023). */}
          <Col span={isOneTime ? 8 : 6}>
            <Form.Item
              name="planned_quantity_kg"
              label={t(
                isOneTime
                  ? 'contracts.create.field.one_time_quantity_kg'
                  : 'contracts.create.field.planned_quantity_kg',
              )}
              extra={isOneTime ? t('contracts.create.field.one_time_quantity_hint') : undefined}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Price per kg (USD) */}
          <Col span={isOneTime ? 8 : 6}>
            <Form.Item
              name="price_per_kg"
              label={t('contracts.create.field.price_per_kg')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber
                min={0}
                step={0.01}
                precision={4}
                style={{ width: '100%' }}
                addonAfter="$/kg"
              />
            </Form.Item>
          </Col>

          {/* Planned amount (USD) — quantity × price */}
          <Col span={isOneTime ? 8 : 6}>
            <Form.Item
              name="planned_amount_usd"
              label={t(
                isOneTime
                  ? 'contracts.create.field.one_time_amount_usd'
                  : 'contracts.create.field.planned_amount_usd',
              )}
              extra={t('contracts.create.field.planned_amount_usd_hint')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="$" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Contract date — printed in the document header after "ş. Asgabat" */}
          <Col span={isOneTime ? 12 : 8}>
            <Form.Item
              name="contract_date"
              label={t('contracts.create.field.contract_date')}
              extra={t('contracts.create.field.contract_date_hint')}
              initialValue={dayjs()}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Start date — printed in §2.6 of the contract */}
          <Col span={isOneTime ? 12 : 8}>
            <Form.Item
              name="start_date"
              label={t('contracts.create.field.start_date')}
              extra={t('contracts.create.field.start_date_hint')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* End date — the contract's validity window (§8.1). A framework notion:
              a one-time contract covers a single shipment, so the payload sends null. */}
          {!isOneTime && (
            <Col span={8}>
              <Form.Item
                name="end_date"
                label={t('contracts.create.field.end_date')}
              >
                <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
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
        </Row>
      </Form>
    </Modal>
  );
}
