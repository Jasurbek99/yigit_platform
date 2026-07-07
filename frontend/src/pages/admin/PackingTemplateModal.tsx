import { useEffect } from 'react';
import { Button, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IPackingTemplate, PackingProductType } from '@/types/packingTemplate';

const { Text } = Typography;

export interface IPackingTemplateFormValues {
  name: string;
  product_type: PackingProductType;
  net_kg: number; gross_kg: number; box_count: number; pallet_count: number; pallet_weight_kg: number;
  shares: { net_kg: number; gross_kg: number; box_count: number; pallet_count: number; pallet_weight_kg: number }[];
  is_active: boolean;
  sort_order: number;
}

interface IProps {
  open: boolean;
  editTarget: IPackingTemplate | null;
  confirmLoading: boolean;
  onOk: () => void;
  onCancel: () => void;
  onFinish: (values: IPackingTemplateFormValues) => void;
  form: FormInstance<IPackingTemplateFormValues>;
}

const NUMS: { key: 'net_kg' | 'gross_kg' | 'box_count' | 'pallet_count' | 'pallet_weight_kg'; label: string; precision: number }[] = [
  { key: 'net_kg', label: 'col_net_kg', precision: 2 },
  { key: 'gross_kg', label: 'col_gross_kg', precision: 2 },
  { key: 'box_count', label: 'col_box_count', precision: 0 },
  { key: 'pallet_count', label: 'col_pallet_count', precision: 1 },
  { key: 'pallet_weight_kg', label: 'col_pallet_weight_kg', precision: 2 },
];

export function PackingTemplateModal({ open, editTarget, confirmLoading, onOk, onCancel, onFinish, form }: IProps): JSX.Element {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      form.setFieldsValue({
        name: editTarget.name,
        product_type: editTarget.product_type,
        net_kg: editTarget.net_kg != null ? parseFloat(editTarget.net_kg) : undefined,
        gross_kg: editTarget.gross_kg != null ? parseFloat(editTarget.gross_kg) : undefined,
        box_count: editTarget.box_count ?? undefined,
        pallet_count: editTarget.pallet_count != null ? parseFloat(editTarget.pallet_count) : undefined,
        pallet_weight_kg: editTarget.pallet_weight_kg != null ? parseFloat(editTarget.pallet_weight_kg) : undefined,
        shares: editTarget.shares.map((s) => ({
          net_kg: s.net_kg != null ? Number(s.net_kg) : undefined,
          gross_kg: s.gross_kg != null ? Number(s.gross_kg) : undefined,
          box_count: s.box_count ?? undefined,
          pallet_count: s.pallet_count != null ? Number(s.pallet_count) : undefined,
          pallet_weight_kg: s.pallet_weight_kg != null ? Number(s.pallet_weight_kg) : undefined,
        })),
        is_active: editTarget.is_active,
        sort_order: editTarget.sort_order,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, sort_order: 10, product_type: 'tomato', shares: [{}] });
    }
  }, [open, editTarget, form]);

  return (
    <Modal
      title={editTarget ? t('packing_template.modal_edit') : t('packing_template.modal_create')}
      open={open} onOk={onOk} onCancel={onCancel} confirmLoading={confirmLoading}
      destroyOnHidden width={680}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 8 }}>
        <Space style={{ width: '100%' }} align="start">
          <Form.Item name="name" label={t('packing_template.col_name')} style={{ flex: 1, minWidth: 260 }}
            rules={[{ required: true, message: t('common.required') }]}>
            <Input placeholder="Tomato · 18000 (10000/8000)" />
          </Form.Item>
          <Form.Item name="product_type" label={t('packing_template.col_product_type')}
            rules={[{ required: true, message: t('common.required') }]}>
            <Select style={{ width: 140 }} options={[
              { value: 'tomato', label: t('packing_template.product_type_tomato') },
              { value: 'pepper', label: t('packing_template.product_type_pepper') },
            ]} />
          </Form.Item>
        </Space>

        <Divider style={{ margin: '4px 0 12px' }}>
          <Text style={{ fontSize: 12 }}>{t('packing_template.whole_truck')} → CMR</Text>
        </Divider>
        <Space wrap>
          {NUMS.map(({ key, label, precision }) => (
            <Form.Item key={key} name={key} label={t(`packing_template.${label}`)} style={{ marginBottom: 8 }}>
              <InputNumber min={0} precision={precision} style={{ width: 110 }} />
            </Form.Item>
          ))}
        </Space>

        <Divider style={{ margin: '4px 0 12px' }}>
          <Text style={{ fontSize: 12 }}>{t('packing_template.firm_shares')} → Invoice</Text>
        </Divider>
        <Form.List name="shares">
          {(shareFields, { add, remove }) => (
            <>
              {shareFields.map((field, idx) => (
                <Space key={field.key} align="baseline" wrap style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11, width: 22 }}>{idx + 1}.</Text>
                  {NUMS.map(({ key, precision }) => (
                    <Form.Item key={key} name={[field.name, key]} style={{ marginBottom: 4 }}>
                      <InputNumber min={0} precision={precision} style={{ width: 96 }}
                        placeholder={t(`packing_template.${NUMS.find((n) => n.key === key)!.label}`)} />
                    </Form.Item>
                  ))}
                  <MinusCircleOutlined onClick={() => remove(field.name)} style={{ color: '#999' }} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({})} icon={<PlusOutlined />} size="small">
                {t('packing_template.add_share')}
              </Button>
            </>
          )}
        </Form.List>

        <Divider style={{ margin: '12px 0' }} />
        <Space>
          <Form.Item name="sort_order" label={t('packing_template.col_sort_order')} style={{ marginBottom: 0 }}>
            <InputNumber min={0} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('packing_template.col_status')} valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
