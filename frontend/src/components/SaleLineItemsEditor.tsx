import { Alert, Button, Form, Input, InputNumber, Space, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';

interface ISaleLineItemsEditorProps {
  readonly form: FormInstance;
}

interface ILineRow {
  quantity_kg?: number | null;
  price_per_kg?: number | null;
}

/**
 * Editable invoice line items (Form.List `line_items`) for the sale form. Each
 * line is a product name + quantity + price; the amount is quantity × price. The
 * lines must break down the sale — a live banner warns when their sum doesn't
 * match the sale's quantity / total (the backend rejects a mismatch too).
 */
export function SaleLineItemsEditor({ form }: ISaleLineItemsEditorProps) {
  const { t } = useTranslation();
  const lines = (Form.useWatch('line_items', form) as ILineRow[] | undefined) ?? [];
  const quantity = Form.useWatch('quantity_kg', form) as number | null | undefined;
  const total = Form.useWatch('total_usd', form) as number | null | undefined;

  const sumQty = lines.reduce((s, li) => s + (Number(li?.quantity_kg) || 0), 0);
  const sumTotal = lines.reduce(
    (s, li) => s + (Number(li?.quantity_kg) || 0) * (Number(li?.price_per_kg) || 0),
    0,
  );
  const hasLines = lines.length > 0;
  const qtyOff = hasLines && quantity != null && Math.abs(sumQty - quantity) > 0.01;
  const totalOff = hasLines && total != null && Math.abs(sumTotal - total) > 0.01;

  return (
    <Form.List name="line_items">
      {(fields, { add, remove }) => (
        <div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
              <Form.Item name={[field.name, 'product_name']} style={{ marginBottom: 0 }}>
                <Input placeholder={t('sales.lines.product')} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item
                name={[field.name, 'quantity_kg']}
                style={{ marginBottom: 0 }}
                rules={[{ required: true, message: t('common.required') }]}
              >
                <InputNumber placeholder={t('sales.lines.qty')} min={0} precision={2} style={{ width: 110 }} />
              </Form.Item>
              <Form.Item
                name={[field.name, 'price_per_kg']}
                style={{ marginBottom: 0 }}
                rules={[{ required: true, message: t('common.required') }]}
              >
                <InputNumber placeholder={t('sales.lines.price')} min={0} precision={4} style={{ width: 110 }} />
              </Form.Item>
              <DeleteOutlined onClick={() => remove(field.name)} style={{ color: '#c00' }} />
            </Space>
          ))}

          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({})}>
            {t('sales.lines.add')}
          </Button>

          {hasLines && (
            <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
              {t('sales.lines.sum', { qty: sumQty, total: sumTotal.toFixed(2) })}
            </Typography.Text>
          )}
          {(qtyOff || totalOff) && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8, fontSize: 12 }}
              message={t('sales.lines.mismatch')}
            />
          )}
        </div>
      )}
    </Form.List>
  );
}
