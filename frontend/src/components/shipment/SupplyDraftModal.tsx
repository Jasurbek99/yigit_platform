import { Modal, Form, InputNumber, Select, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BlockSelect } from '@/components/BlockSelect';
import { VarietySelect } from '@/components/VarietySelect';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { useCreateSupplyDraft } from '@/hooks/useDrafts';
import { useShipmentOptions } from '@/hooks/useAdmin';
import type { ISupplyDraftPayload } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────

interface ISupplyDraftModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}

interface IFormValues {
  weight_net: number;
  block_ids: number[];
  variety: number | null | undefined;
  harvest_status: string | undefined;
  export_code: string | undefined;
  notes: string | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildPayload(values: IFormValues): ISupplyDraftPayload {
  const payload: ISupplyDraftPayload = {
    weight_net: values.weight_net,
    block_ids: values.block_ids,
  };
  if (values.variety != null) payload.varieties = [values.variety];
  if (values.harvest_status) payload.harvest_status = values.harvest_status;
  if (values.export_code) payload.export_code = values.export_code;
  if (values.notes?.trim()) payload.notes = values.notes.trim();
  return payload;
}

/** Harvest-status Select — options from ShipmentOptionType('harvest_status'), locale-labelled (see FieldEditor's option_select pattern). */
function HarvestStatusSelect() {
  const { t, i18n } = useTranslation();
  const { data: options = [] } = useShipmentOptions('harvest_status');
  const lang = i18n.language;
  const items = options
    .filter((o) => o.is_active)
    .map((o) => ({
      value: o.code,
      label: lang.startsWith('ru') && o.label_ru ? o.label_ru : lang.startsWith('en') && o.label_en ? o.label_en : o.label_tk,
    }));
  return <Select options={items} allowClear placeholder={t('supply_draft.harvest_status_ph')} />;
}

/** Optional fields — variety, harvest status, export code, notes. Extracted to keep the modal under 150 lines. */
function SupplyDraftOptionalFields() {
  const { t } = useTranslation();
  return (
    <>
      <Form.Item name="variety" label={t('supply_draft.field_variety')}>
        <VarietySelect placeholder={t('supply_draft.variety_ph')} />
      </Form.Item>
      <Form.Item name="harvest_status" label={t('supply_draft.field_harvest_status')}>
        <HarvestStatusSelect />
      </Form.Item>
      <Form.Item name="export_code" label={t('supply_draft.field_export_code')}>
        <OfficialCodeEditor value="" onChange={() => {}} />
      </Form.Item>
      <Form.Item name="notes" label={t('supply_draft.field_notes')}>
        <Input.TextArea rows={2} placeholder={t('supply_draft.notes_ph')} />
      </Form.Item>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

/** Modal to create a SUPPLY draft (blocks + total weight, no per-block split, no destination). */
export function SupplyDraftModal({ open, onClose, onSuccess }: ISupplyDraftModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();
  const createSupplyDraft = useCreateSupplyDraft();

  async function handleOk() {
    let values: IFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd already renders the inline field errors
    }
    const payload = buildPayload(values);
    createSupplyDraft.mutate(payload, {
      onSuccess: () => {
        toast.success(t('supply_draft.toast_success'));
        form.resetFields();
        onSuccess();
        onClose();
      },
      onError: () => toast.error(t('supply_draft.toast_error')),
    });
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      title={t('supply_draft.title')}
      open={open}
      onCancel={handleCancel}
      onOk={() => void handleOk()}
      okText={t('supply_draft.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={createSupplyDraft.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ block_ids: [] }}>
        <Form.Item
          name="weight_net"
          label={t('supply_draft.field_weight')}
          rules={[
            { required: true, message: t('common.required') },
            { type: 'number', min: 0.01, message: t('supply_draft.error_weight_positive') },
          ]}
        >
          <InputNumber<number> min={0} style={{ width: '100%' }} placeholder={t('supply_draft.weight_ph')} />
        </Form.Item>

        <Form.Item
          name="block_ids"
          label={t('supply_draft.field_blocks')}
          rules={[{ required: true, message: t('supply_draft.error_blocks') }]}
        >
          <BlockSelect mode="multiple" placeholder={t('supply_draft.blocks_ph')} />
        </Form.Item>

        <SupplyDraftOptionalFields />
      </Form>
    </Modal>
  );
}
