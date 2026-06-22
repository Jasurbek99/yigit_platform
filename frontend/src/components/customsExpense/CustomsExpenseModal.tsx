import { useEffect } from 'react';
import {
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Button,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useCreateCustomsExpense,
  useUpdateCustomsExpense,
} from '@/hooks/useCustomsExpenses';
import { ShipmentSelect } from '@/components/ShipmentSelect';
import { CUSTOMS_EXPENSE_CATEGORIES } from '@/types';
import type {
  ICustomsExpense,
  CustomsExpenseCategory,
  IShipmentListItem,
} from '@/types';

interface IExpenseFormValues {
  expense_date: Dayjs | null;
  category: CustomsExpenseCategory | null;
  amount: number | null;
  shipment: number | null;
  export_code_raw: string | null;
  vehicle_plate: string | null;
  route_label: string | null;
  label_raw: string | null;
  quantity: number | null;
  notes: string | null;
}

interface ICustomsExpenseModalProps {
  open: boolean;
  onClose: () => void;
  /** If provided, we're editing an existing expense. */
  editTarget: ICustomsExpense | null;
  /** Pre-fills the shipment id (e.g. from ShipmentDetail "Add expense" button). */
  prefilledShipmentId?: number | null;
  /** Pre-fills export_code_raw (the shipment's Export Code). */
  prefilledExportCode?: string | null;
}

export function CustomsExpenseModal({
  open,
  onClose,
  editTarget,
  prefilledShipmentId,
  prefilledExportCode,
}: ICustomsExpenseModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [form] = Form.useForm<IExpenseFormValues>();
  const createExpense = useCreateCustomsExpense();
  const updateExpense = useUpdateCustomsExpense();

  const isEdit = editTarget !== null;
  const isPending = createExpense.isPending || updateExpense.isPending;

  // When modal opens, populate form
  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      form.setFieldsValue({
        expense_date: dayjs(editTarget.expense_date),
        category: editTarget.category,
        amount: Number(editTarget.amount),
        shipment: editTarget.shipment,
        export_code_raw: editTarget.export_code_raw,
        vehicle_plate: editTarget.vehicle_plate,
        route_label: editTarget.route_label,
        label_raw: editTarget.label_raw,
        quantity: editTarget.quantity,
        notes: editTarget.notes,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        expense_date: dayjs(),
        shipment: prefilledShipmentId ?? null,
        export_code_raw: prefilledExportCode ?? null,
      });
    }
  }, [open, editTarget, prefilledShipmentId, prefilledExportCode, form]);

  function handleCancel(): void {
    form.resetFields();
    onClose();
  }

  /** Auto-fill the export code + plate from the picked shipment. */
  function handleShipmentPick(shipment: IShipmentListItem | null): void {
    if (!shipment) return;
    form.setFieldsValue({
      export_code_raw: shipment.export_code ?? form.getFieldValue('export_code_raw'),
      vehicle_plate: shipment.truck_plate ?? form.getFieldValue('vehicle_plate'),
    });
  }

  function handleFinish(values: IExpenseFormValues): void {
    const dateStr = values.expense_date
      ? values.expense_date.format('YYYY-MM-DD')
      : '';

    const payload = {
      expense_date: dateStr,
      category: values.category as CustomsExpenseCategory,
      amount: values.amount != null ? String(values.amount) : '0',
      currency: 'TMT',
      shipment: values.shipment ?? null,
      export_code_raw: values.export_code_raw || null,
      vehicle_plate: values.vehicle_plate || null,
      route_label: values.route_label || null,
      label_raw: values.label_raw || null,
      quantity: values.quantity ?? null,
      notes: values.notes || null,
    };

    if (isEdit && editTarget) {
      updateExpense.mutate(
        { id: editTarget.id, payload },
        {
          onSuccess: () => {
            toast.success(t('customs_expense.update_success'));
            form.resetFields();
            onClose();
          },
          onError: () => {
            toast.error(t('customs_expense.error_save'));
          },
        },
      );
    } else {
      createExpense.mutate(payload, {
        onSuccess: () => {
          toast.success(t('customs_expense.create_success'));
          form.resetFields();
          onClose();
        },
        onError: () => {
          toast.error(t('customs_expense.error_save'));
        },
      });
    }
  }

  const categoryOptions = CUSTOMS_EXPENSE_CATEGORIES.map((code) => ({
    value: code,
    label: t(`customs_expense.category.${code}`),
  }));

  const isShipmentPrefilled =
    !isEdit && prefilledShipmentId != null;

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={isEdit ? t('customs_expense.edit') : t('customs_expense.add')}
      footer={null}
      destroyOnClose
    >
      <Form<IExpenseFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
      >
        <Form.Item
          name="expense_date"
          label={t('customs_expense.field_date')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="category"
          label={t('customs_expense.field_category')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Select
            options={categoryOptions}
            showSearch
            placeholder={t('common.select')}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item
          name="amount"
          label={t('customs_expense.field_amount')}
          rules={[
            { required: true, message: t('common.required') },
            { type: 'number', min: 0.01, message: t('customs_expense.validation_amount_positive') },
          ]}
        >
          <InputNumber<number>
            min={0}
            precision={2}
            style={{ width: '100%' }}
            suffix="TMT"
            formatter={(value) =>
              value != null
                ? `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                : ''
            }
            parser={(value): number => {
              const cleaned = (value ?? '').replace(/\s/g, '');
              const n = Number(cleaned);
              return Number.isFinite(n) ? n : 0;
            }}
          />
        </Form.Item>

        {/* Shipment linkage — search by shipment code; hidden when pre-filled from shipment detail */}
        {isShipmentPrefilled ? null : (
          <Form.Item
            name="shipment"
            label={t('customs_expense.field_shipment')}
          >
            <ShipmentSelect
              onPick={handleShipmentPick}
              placeholder={t('customs_expense.shipment_search_placeholder')}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )}

        <Form.Item
          name="export_code_raw"
          label={t('customs_expense.field_export_code_raw')}
        >
          <Input placeholder={t('common.optional')} />
        </Form.Item>

        <Form.Item
          name="vehicle_plate"
          label={t('customs_expense.field_vehicle_plate')}
        >
          <Input placeholder={t('common.optional')} />
        </Form.Item>

        <Form.Item
          name="route_label"
          label={t('customs_expense.field_route_label')}
        >
          <Input placeholder={t('common.optional')} />
        </Form.Item>

        <Form.Item
          name="label_raw"
          label={t('customs_expense.field_label_raw')}
        >
          <Input placeholder={t('common.optional')} />
        </Form.Item>

        <Form.Item
          name="quantity"
          label={t('customs_expense.field_quantity')}
        >
          <InputNumber<number>
            style={{ width: '100%' }}
            min={0}
            precision={0}
            placeholder={t('common.optional')}
          />
        </Form.Item>

        <Form.Item name="notes" label={t('customs_expense.field_notes')}>
          <Input.TextArea rows={2} />
        </Form.Item>

        <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button onClick={handleCancel}>{t('common.cancel')}</Button>
          <Button type="primary" htmlType="submit" loading={isPending}>
            {isEdit ? t('common.save') : t('customs_expense.add')}
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
