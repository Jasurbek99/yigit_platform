import { useState } from 'react';
import { Button, Divider, Form, Input, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { isAxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useCreateCustomsExpenseCategory,
  useCustomsExpenseCategories,
  useCustomsExpenseCategoryLabel,
} from '@/hooks/useCustomsExpenses';

interface ICategoryFormValues {
  label_tk: string;
  label_ru?: string;
  label_en?: string;
}

interface ICustomsExpenseCategorySelectProps {
  value?: string | null;
  onChange?: (value: string) => void;
}

/**
 * Category picker for the customs expense form. "Add new" at the bottom of the
 * list opens a small form (Turkmen name required) and selects the new category.
 * Only rendered inside the expense modal, which only write roles can open.
 */
export function CustomsExpenseCategorySelect({
  value,
  onChange,
}: ICustomsExpenseCategorySelectProps): React.ReactElement {
  const { t } = useTranslation();
  const [form] = Form.useForm<ICategoryFormValues>();
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const { data: categories = [], isLoading } = useCustomsExpenseCategories();
  const createCategory = useCreateCustomsExpenseCategory();
  const labelOf = useCustomsExpenseCategoryLabel();

  const options = categories.map((c) => ({ value: c.code, label: labelOf(c.code) }));

  function openForm(): void {
    setListOpen(false);
    form.resetFields();
    form.setFieldsValue({ label_tk: search.trim() });
    setFormOpen(true);
  }

  function handleSave(values: ICategoryFormValues): void {
    createCategory.mutate(
      {
        label_tk: values.label_tk.trim(),
        label_ru: values.label_ru?.trim() || undefined,
        label_en: values.label_en?.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          toast.success(t('customs_expense.category_create_success'));
          onChange?.(created.code);
          setSearch('');
          setFormOpen(false);
        },
        onError: (err) => {
          const duplicate = isAxiosError(err) && err.response?.data?.label_tk;
          toast.error(t(duplicate ? 'customs_expense.category_duplicate' : 'customs_expense.category_error_save'));
        },
      },
    );
  }

  return (
    <>
      <Select
        value={value ?? undefined}
        onChange={onChange}
        options={options}
        loading={isLoading}
        showSearch
        searchValue={search}
        onSearch={setSearch}
        open={listOpen}
        onOpenChange={setListOpen}
        placeholder={t('common.select')}
        filterOption={(input, option) =>
          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        popupRender={(menu) => (
          <>
            {menu}
            <Divider style={{ margin: '4px 0' }} />
            <Button
              type="text"
              icon={<PlusOutlined />}
              block
              style={{ textAlign: 'left' }}
              // Keep the Select focused so the click lands before the list closes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={openForm}
            >
              {t('customs_expense.add_category')}
            </Button>
          </>
        )}
      />

      <Modal
        open={formOpen}
        title={t('customs_expense.new_category_title')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        onOk={() => form.submit()}
        onCancel={() => setFormOpen(false)}
        confirmLoading={createCategory.isPending}
        // Keep the form mounted so openForm can reset and prefill it.
        forceRender
      >
        <Form<ICategoryFormValues> form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="label_tk"
            label={t('customs_expense.field_category_name_tk')}
            rules={[{ required: true, whitespace: true, message: t('common.required') }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="label_ru" label={t('customs_expense.field_category_name_ru')}>
            <Input maxLength={100} placeholder={t('common.optional')} />
          </Form.Item>
          <Form.Item name="label_en" label={t('customs_expense.field_category_name_en')}>
            <Input maxLength={100} placeholder={t('common.optional')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
