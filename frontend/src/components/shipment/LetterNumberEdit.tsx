import { useState } from 'react';
import { Button, InputNumber, Popover, Space, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSaveLetterNumber, type LetterNumberField } from '@/hooks/useSaleLetterNumbers';

const { Text } = Typography;

interface ILetterNumberEditProps {
  readonly saleId: number;
  readonly field: LetterNumberField;
  readonly value: number | null;
  readonly canEdit: boolean;
}

/**
 * A request letter's outgoing number («№ 15») next to its download row, with a
 * ✎ to correct it by hand. The server refuses a number the firm already used for
 * this letter this year and says so; that message is shown as is.
 */
export function LetterNumberEdit({ saleId, field, value, canEdit }: ILetterNumberEditProps) {
  if (value === null) return null;
  return (
    <Space size={2}>
      <Text type="secondary">№ {value}</Text>
      {canEdit && <LetterNumberEditor saleId={saleId} field={field} value={value} />}
    </Space>
  );
}

function LetterNumberEditor({ saleId, field, value }: Omit<ILetterNumberEditProps, 'canEdit'> & { value: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const save = useSaveLetterNumber(saleId);

  const submit = () => {
    if (draft == null) return;
    save.mutate({ [field]: draft }, {
      onSuccess: () => {
        toast.success(t('shipment_detail.docs.letter_number_saved'));
        setOpen(false);
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error(msg ?? t('common.error'));
      },
    });
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) setDraft(value); }}
      content={(
        <Space>
          <InputNumber min={1} precision={0} value={draft} onChange={(v) => setDraft(v)} onPressEnter={submit} />
          <Button type="primary" size="small" loading={save.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </Space>
      )}
    >
      <Button
        type="text"
        size="small"
        icon={<EditOutlined />}
        aria-label={t('shipment_detail.docs.letter_number_edit')}
      />
    </Popover>
  );
}
