import { useEffect } from 'react';
import { Form, Input, InputNumber, Switch, Select, Modal } from 'antd';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IPackingPreset, PackingProductType } from '@/types/packingPreset';

export interface IPackingPresetFormValues {
  name: string;
  product_type: PackingProductType;
  net_kg: number;
  gross_kg: number;
  box_count: number;
  pallet_count: number;
  pallet_weight_kg: number;
  is_active: boolean;
  sort_order: number;
}

interface IPackingPresetModalProps {
  open: boolean;
  editTarget: IPackingPreset | null;
  confirmLoading: boolean;
  onOk: () => void;
  onCancel: () => void;
  onFinish: (values: IPackingPresetFormValues) => void;
  form: FormInstance<IPackingPresetFormValues>;
}

export function PackingPresetModal({
  open,
  editTarget,
  confirmLoading,
  onOk,
  onCancel,
  onFinish,
  form,
}: IPackingPresetModalProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      form.setFieldsValue({
        name: editTarget.name,
        product_type: editTarget.product_type,
        net_kg: parseFloat(editTarget.net_kg),
        gross_kg: parseFloat(editTarget.gross_kg),
        box_count: editTarget.box_count,
        pallet_count: parseFloat(editTarget.pallet_count),
        pallet_weight_kg: parseFloat(editTarget.pallet_weight_kg),
        is_active: editTarget.is_active,
        sort_order: editTarget.sort_order,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, sort_order: 10 });
    }
  }, [open, editTarget, form]);

  const isEdit = editTarget !== null;
  const title = isEdit
    ? t('packing_preset.modal_edit')
    : t('packing_preset.modal_create');

  const productTypeOptions: { value: PackingProductType; label: string }[] = [
    { value: 'tomato', label: t('packing_preset.product_type_tomato') },
    { value: 'pepper', label: t('packing_preset.product_type_pepper') },
  ];

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      destroyOnHidden
      width={520}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 8 }}>
        <Form.Item
          name="name"
          label={t('packing_preset.col_name')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="product_type"
          label={t('packing_preset.col_product_type')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Select options={productTypeOptions} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="net_kg"
          label={t('packing_preset.col_net_kg')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="kg" />
        </Form.Item>

        <Form.Item
          name="gross_kg"
          label={t('packing_preset.col_gross_kg')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="kg" />
        </Form.Item>

        <Form.Item
          name="box_count"
          label={t('packing_preset.col_box_count')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={0} precision={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="pallet_count"
          label={t('packing_preset.col_pallet_count')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={0} precision={1} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="pallet_weight_kg"
          label={t('packing_preset.col_pallet_weight_kg')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="kg" />
        </Form.Item>

        <Form.Item name="sort_order" label={t('packing_preset.col_sort_order')}>
          <InputNumber min={0} precision={0} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          name="is_active"
          label={t('packing_preset.col_status')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
