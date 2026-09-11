import { useEffect } from 'react';
import { Alert, Col, Form, InputNumber, Modal, Row } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateContractPlan } from '@/hooks/useContracts';
import { deriveContractPlan } from '@/utils/contractPlan';
import type { ContractPlanField, IContractPlan } from '@/utils/contractPlan';
import type { IContractDetail } from '@/types/contract';

/**
 * The fields deriveContractPlan() understands. The form holds exactly these
 * today, but the guard is not redundant: add a fifth field without it and the
 * cast below still succeeds, the rule falls through to its default branch and
 * silently clobbers planned_amount_usd. ContractCreate carries the same guard.
 */
const PLAN_FIELDS: ContractPlanField[] = [
  'planned_trucks', 'planned_quantity_kg', 'price_per_kg', 'planned_amount_usd',
];

interface IContractPlanEditProps {
  readonly open: boolean;
  readonly contract: IContractDetail;
  readonly onClose: () => void;
}

function toNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Edit a contract's planned block after it exists.
 *
 * The contract .docx prints its quantity, price and total straight off these
 * fields, and a contract auto-created from the Sheet before 2026-09-10 has all
 * of them NULL — the document comes out blank exactly where it matters. Nothing
 * else on the contract is editable here: the firms, the number and the dates are
 * its identity, and the exported/remaining totals belong to the rollup service.
 */
export function ContractPlanEdit({ open, contract, onClose }: IContractPlanEditProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IContractPlan>();
  const update = useUpdateContractPlan(contract.id);
  // Same rule as the create form: a one-time contract is one export firm's share
  // of one truck, so it has no truck count to plan and its weight is not a
  // multiple of a truckload. Showing the field here would contradict the form the
  // contract was created in.
  const isOneTime = contract.contract_type === 'ONE_TIME';

  // Re-seed on open: the detail data can change under a modal that stays mounted.
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      planned_trucks: toNumber(contract.planned_trucks),
      planned_quantity_kg: toNumber(contract.planned_quantity_kg),
      price_per_kg: toNumber(contract.price_per_kg),
      planned_amount_usd: toNumber(contract.planned_amount_usd),
    });
  }, [open, contract, form]);

  const handleValuesChange = (changed: Partial<IContractPlan>) => {
    const edited = Object.keys(changed)[0] as ContractPlanField | undefined;
    if (!edited || !PLAN_FIELDS.includes(edited)) return;
    form.setFieldsValue(
      deriveContractPlan(form.getFieldsValue(), edited, { linkTrucks: !isOneTime }),
    );
  };

  const handleSubmit = async () => {
    let values: IContractPlan;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design shows per-field errors inline
    }
    try {
      await update.mutateAsync({
        planned_trucks: isOneTime ? 1 : values.planned_trucks ?? null,
        planned_quantity_kg: values.planned_quantity_kg ?? null,
        price_per_kg: values.price_per_kg ?? null,
        planned_amount_usd: values.planned_amount_usd ?? null,
      });
      toast.success(t('contracts.plan_edit.toast_saved'));
      onClose();
    } catch {
      toast.error(t('contracts.plan_edit.toast_error'));
    }
  };

  return (
    <Modal
      open={open}
      title={t('contracts.plan_edit.title')}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={update.isPending}
      okText={t('common.save')}
      destroyOnClose
    >
      {/* The invoice reads the SALE's own price, not this one. Saying so here is
          the whole reason an operator does not end up with a corrected contract
          and a stale invoice quietly disagreeing about the same truck. */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('contracts.plan_edit.scope_hint')}
      />
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        <Row gutter={16}>
          {!isOneTime && (
            <Col span={12}>
              <Form.Item
                name="planned_trucks"
                label={t('contracts.column.planned_trucks')}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          <Col span={12}>
            <Form.Item
              name="planned_quantity_kg"
              label={t(
                isOneTime
                  ? 'contracts.create.field.one_time_quantity_kg'
                  : 'contracts.column.planned_quantity_kg',
              )}
              extra={isOneTime ? t('contracts.create.field.one_time_quantity_hint') : undefined}
            >
              <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="kg" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="price_per_kg"
              label={t('contracts.create.field.price_per_kg')}
            >
              <InputNumber
                min={0}
                max={9999.9999}
                step={0.01}
                precision={4}
                style={{ width: '100%' }}
                prefix="$"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="planned_amount_usd"
              label={t('contracts.column.planned_amount_usd')}
              extra={t('contracts.plan_edit.amount_hint')}
            >
              <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
