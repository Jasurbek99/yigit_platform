import { useEffect, useRef } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Select,
  Checkbox,
  Row,
  Col,
  Alert,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateInvoice, useUpdateInvoice } from '@/hooks/useInvoices';
import { useContract } from '@/hooks/useContracts';
import { ContractSelect } from '@/components/ContractSelect';
import type { IInvoice, IInvoiceCreatePayload, InvoiceStatus } from '@/types/invoice';

// ─── Status options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: InvoiceStatus[] = ['draft', 'sent', 'paid', 'void'];

// ─── Form shape ───────────────────────────────────────────────────────────────

interface IFormValues {
  contract_id?: number | null;
  invoice_number: number;
  invoice_date: dayjs.Dayjs;
  serial_truck_number?: number | null;
  quantity_kg?: number | null;
  price_per_kg?: number | null;
  total_usd?: number | null;
  passport_sdelka?: string;
  scan_uploaded?: boolean;
  status: InvoiceStatus;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface IInvoiceCreateProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Called when the modal closes (cancel or success) */
  onClose: () => void;
  /**
   * The contract this invoice belongs to.
   * When omitted the modal renders in standalone mode and shows a ContractSelect
   * as the first field.
   */
  contractId?: number;
  /**
   * Pre-filled invoice number (= contract.last_invoice_number + 1).
   * User can override.
   * When omitted (standalone mode) the number is derived from the selected
   * contract's last_invoice_number once a contract is picked.
   */
  nextInvoiceNumber?: number;
  /**
   * When set, the modal operates in EDIT mode: pre-fills fields from
   * the existing invoice and PATCHes on submit instead of POSTing.
   */
  editingInvoice?: IInvoice | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceCreate({
  open,
  onClose,
  contractId,
  nextInvoiceNumber,
  editingInvoice = null,
}: IInvoiceCreateProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();
  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();

  const isEditing = editingInvoice !== null;
  const isStandalone = contractId === undefined;
  const isPending = createMutation.isPending || updateMutation.isPending;

  // In standalone mode, watch the selected contract_id to fetch last_invoice_number
  const watchedContractId = Form.useWatch('contract_id', form);
  const resolvedContractId: number = isEditing
    ? (editingInvoice?.contract ?? 0)
    : (contractId ?? watchedContractId ?? 0);

  const { data: contractDetail } = useContract(resolvedContractId);

  // Track whether the user has manually overridden total_usd so auto-fill
  // doesn't clobber their override.
  const userManuallyEditedTotal = useRef<boolean>(false);

  // ─── Auto-compute total_usd from qty * price ──────────────────────────────

  const handleMoneyFieldChange = () => {
    if (userManuallyEditedTotal.current) return;
    const qty = form.getFieldValue('quantity_kg') as number | null | undefined;
    const price = form.getFieldValue('price_per_kg') as number | null | undefined;
    if (qty != null && qty > 0 && price != null && price > 0) {
      form.setFieldValue('total_usd', Math.round(qty * price));
    }
  };

  const handleTotalUsdChange = () => {
    userManuallyEditedTotal.current = true;
  };

  // In standalone mode, auto-fill invoice_number when user picks a contract
  const handleContractChange = (selectedContractId: number | null) => {
    if (!selectedContractId) return;
    // contractDetail will refetch; once it lands, we set the number
    // The effect below handles this via contractDetail dep
    form.setFieldValue('contract_id', selectedContractId);
  };

  // When contractDetail loads in standalone/create mode, auto-fill invoice_number.
  // Uses useEffect to avoid calling form.setFieldValue during render (StrictMode safe).
  const prevContractIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isStandalone || isEditing || !contractDetail) return;
    if (contractDetail.id === prevContractIdRef.current) return;
    prevContractIdRef.current = contractDetail.id;
    const autoNumber = (contractDetail.last_invoice_number ?? 0) + 1;
    form.setFieldValue('invoice_number', autoNumber);
  }, [contractDetail?.id, isStandalone, isEditing, form]);

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    let values: IFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design renders per-field errors inline
    }

    // Resolve the contract ID
    const resolvedContract = isStandalone
      ? (values.contract_id ?? null)
      : contractId;

    if (!resolvedContract) {
      form.setFields([{
        name: 'contract_id',
        errors: [t('common.required')],
      }]);
      return;
    }

    // Cross-field money validation: (qty + price) OR total must be filled
    const hasComponents =
      values.quantity_kg != null && values.price_per_kg != null;
    const hasTotal = values.total_usd != null;

    if (!hasComponents && !hasTotal) {
      form.setFields([
        {
          name: 'total_usd',
          errors: [t('invoices.create.validation.money_required')],
        },
        {
          name: 'quantity_kg',
          errors: [t('invoices.create.validation.money_required')],
        },
      ]);
      return;
    }

    // Build payload — strip nulls/undefined optional fields
    const payload: IInvoiceCreatePayload = {
      contract: resolvedContract,
      invoice_number: values.invoice_number,
      invoice_date: values.invoice_date.format('YYYY-MM-DD'),
      status: values.status ?? 'sent',
    };

    if (values.serial_truck_number != null) {
      payload.serial_truck_number = values.serial_truck_number;
    }
    if (values.quantity_kg != null) {
      payload.quantity_kg = values.quantity_kg;
    }
    if (values.price_per_kg != null) {
      payload.price_per_kg = values.price_per_kg;
    }
    // Only send total_usd if qty+price are NOT both filled (let backend auto-compute),
    // OR if the user manually entered a total.
    if (hasTotal && (!hasComponents || userManuallyEditedTotal.current)) {
      payload.total_usd = values.total_usd;
    }
    if (values.passport_sdelka?.trim()) {
      payload.passport_sdelka = values.passport_sdelka.trim();
    }
    if (values.scan_uploaded) {
      payload.scan_uploaded = values.scan_uploaded;
    }

    try {
      if (isEditing && editingInvoice) {
        await updateMutation.mutateAsync({
          id: editingInvoice.id,
          payload,
        });
        toast.success(t('invoices.edit.toast.updated'));
      } else {
        await createMutation.mutateAsync(payload);
        toast.success(t('invoices.create.toast.created'));
      }
      form.resetFields();
      userManuallyEditedTotal.current = false;
      prevContractIdRef.current = null;
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
        toast.error(
          isEditing
            ? t('invoices.edit.toast.error')
            : t('invoices.create.toast.error'),
        );
      }
    }
  };

  const handleCancel = () => {
    form.resetFields();
    userManuallyEditedTotal.current = false;
    prevContractIdRef.current = null;
    onClose();
  };

  // ─── Initial values ────────────────────────────────────────────────────────

  const initialValues = isEditing && editingInvoice
    ? {
        contract_id: editingInvoice.contract,
        invoice_number: editingInvoice.invoice_number,
        invoice_date: dayjs(editingInvoice.invoice_date),
        serial_truck_number: editingInvoice.serial_truck_number,
        quantity_kg: editingInvoice.quantity_kg != null
          ? parseFloat(editingInvoice.quantity_kg)
          : null,
        price_per_kg: editingInvoice.price_per_kg != null
          ? parseFloat(editingInvoice.price_per_kg)
          : null,
        total_usd: editingInvoice.total_usd != null
          ? parseFloat(editingInvoice.total_usd)
          : null,
        passport_sdelka: editingInvoice.passport_sdelka,
        scan_uploaded: editingInvoice.scan_uploaded,
        status: editingInvoice.status,
      }
    : {
        invoice_number: nextInvoiceNumber ?? 1,
        invoice_date: dayjs(),
        status: 'sent' as InvoiceStatus,
        scan_uploaded: false,
      };

  const titleKey = isEditing ? 'invoices.edit.title' : 'invoices.create.title';
  const submitKey = isEditing ? 'invoices.edit.submit' : 'invoices.create.submit';

  return (
    <Modal
      title={t(titleKey)}
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText={t(submitKey)}
      cancelText={t('invoices.create.cancel')}
      confirmLoading={isPending}
      width={580}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        size="middle"
        style={{ marginTop: 16 }}
        initialValues={initialValues}
      >
        {/* Contract picker — only in standalone (non-tab) mode */}
        {isStandalone && (
          <Form.Item
            name="contract_id"
            label={t('invoices.create.field.contract')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <ContractSelect
              includeEnded
              style={{ width: '100%' }}
              onChange={handleContractChange}
            />
          </Form.Item>
        )}

        <Row gutter={16}>
          {/* Invoice number */}
          <Col span={12}>
            <Form.Item
              name="invoice_number"
              label={t('invoices.create.field.invoice_number')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <InputNumber precision={0} min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Invoice date */}
          <Col span={12}>
            <Form.Item
              name="invoice_date"
              label={t('invoices.create.field.invoice_date')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Serial truck number */}
          <Col span={12}>
            <Form.Item
              name="serial_truck_number"
              label={t('invoices.create.field.serial_truck_number')}
            >
              <InputNumber precision={0} min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Status */}
          <Col span={12}>
            <Form.Item
              name="status"
              label={t('invoices.create.field.status')}
            >
              <Select
                options={STATUS_OPTIONS.map((s) => ({
                  value: s,
                  label: t(`invoices.status.${s}`),
                }))}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* Money section */}
        <Alert
          type="info"
          showIcon
          message={t('invoices.create.money_hint')}
          style={{ marginBottom: 12, fontSize: 12 }}
        />

        <Row gutter={16}>
          {/* Quantity (kg) */}
          <Col span={8}>
            <Form.Item
              name="quantity_kg"
              label={t('invoices.create.field.quantity_kg')}
            >
              <InputNumber
                precision={0}
                min={0}
                style={{ width: '100%' }}
                onChange={handleMoneyFieldChange}
              />
            </Form.Item>
          </Col>

          {/* Price per kg */}
          <Col span={8}>
            <Form.Item
              name="price_per_kg"
              label={t('invoices.create.field.price_per_kg')}
            >
              <InputNumber
                precision={4}
                min={0}
                style={{ width: '100%' }}
                onChange={handleMoneyFieldChange}
              />
            </Form.Item>
          </Col>

          {/* Total USD */}
          <Col span={8}>
            <Form.Item
              name="total_usd"
              label={t('invoices.create.field.total_usd')}
            >
              <InputNumber
                precision={0}
                min={0}
                style={{ width: '100%' }}
                addonAfter="$"
                onChange={handleTotalUsdChange}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Passport sdelka */}
          <Col span={16}>
            <Form.Item
              name="passport_sdelka"
              label={t('invoices.create.field.passport_sdelka')}
            >
              <Input />
            </Form.Item>
          </Col>

          {/* Scan uploaded */}
          <Col span={8} style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <Form.Item name="scan_uploaded" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>{t('invoices.create.field.scan_uploaded')}</Checkbox>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
