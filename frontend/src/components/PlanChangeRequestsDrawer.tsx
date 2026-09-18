import { useState } from 'react';
import { Alert, Button, Drawer, Input, Modal, Popconfirm, Segmented, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useApprovePlanChange, usePlanChangeRequests, useRejectPlanChange } from '@/hooks/usePlanning';
import { fmtKg } from '@/components/HarvestCell.helpers';
import type { IPlanChangeRequest, PlanChangeStatus } from '@/types';

/**
 * The in-week plan revision log and approval queue (ADR-024).
 *
 * Everyone who reaches the Weekly Plan page may read it; `canDecide`
 * (export_manager / admin / boss) adds Approve / Reject on pending rows.
 * The backend re-checks the role — this flag only decides what to render.
 */
interface IPlanChangeRequestsDrawerProps {
  open: boolean;
  onClose: () => void;
  year: number | undefined;
  week: number | undefined;
  canDecide: boolean;
}

const STATUS_COLOR: Record<PlanChangeStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
  superseded: 'default',
};

function PctCell({ pct }: { pct: string | null }) {
  if (pct == null) return <span>—</span>;
  const n = Number(pct);
  const color = n > 0 ? '#389e0d' : n < 0 ? '#cf1322' : undefined;
  return <span style={{ color, fontWeight: 600 }}>{n > 0 ? '+' : ''}{n}%</span>;
}

export function PlanChangeRequestsDrawer({ open, onClose, year, week, canDecide }: IPlanChangeRequestsDrawerProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  // Every week by default: from Friday the grid shows NEXT week, while the
  // requests still waiting are usually the current week's.
  const [scope, setScope] = useState<'week' | 'all'>('all');
  const [rejecting, setRejecting] = useState<IPlanChangeRequest | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading, isError } = usePlanChangeRequests({
    status: statusFilter === 'pending' ? 'pending' : undefined,
    ...(scope === 'week' ? { year, week } : {}),
  });
  const approve = useApprovePlanChange();
  const reject = useRejectPlanChange();

  function handleApprove(row: IPlanChangeRequest) {
    approve.mutate(
      { id: row.id },
      {
        onSuccess: () => toast.success(t('plan.toast_change_approved')),
        onError: () => toast.error(t('common.error')),
      },
    );
  }

  function closeReject() {
    setRejecting(null);
    setNote('');
  }

  function handleReject() {
    if (!rejecting) return;
    reject.mutate(
      { id: rejecting.id, note },
      {
        onSuccess: () => {
          toast.success(t('plan.toast_change_rejected'));
          closeReject();
        },
        onError: () => toast.error(t('common.error')),
      },
    );
  }

  const columns: TableColumnsType<IPlanChangeRequest> = [
    { title: t('plan.change_col_block'), dataIndex: 'block_code', width: 70 },
    {
      title: t('plan.change_col_day'), dataIndex: 'entry_date', width: 90,
      render: (d: string) => dayjs(d).format('DD.MM ddd'),
    },
    { title: t('plan.change_col_baseline'), dataIndex: 'baseline_value', align: 'right', render: fmtKg },
    { title: t('plan.change_col_current'), dataIndex: 'current_value', align: 'right', render: fmtKg },
    { title: t('plan.change_col_requested'), dataIndex: 'requested_value', align: 'right', render: fmtKg },
    { title: '±%', dataIndex: 'change_pct', align: 'right', render: (p: string | null) => <PctCell pct={p} /> },
    { title: t('plan.change_col_requested_by'), dataIndex: 'requested_by_name' },
    { title: t('plan.change_col_reason'), dataIndex: 'reason' },
    {
      title: t('plan.change_col_status'), dataIndex: 'status',
      render: (s: PlanChangeStatus) => <Tag color={STATUS_COLOR[s]}>{t(`plan.change_status_${s}`)}</Tag>,
    },
    {
      title: t('plan.change_col_decided_by'), key: 'decided',
      render: (_: unknown, row) =>
        row.decided_by_name ? `${row.decided_by_name} · ${dayjs(row.decided_at).format('DD.MM HH:mm')}` : '—',
    },
    { title: t('plan.change_col_note'), dataIndex: 'decision_note' },
    ...(canDecide
      ? [{
          key: 'actions',
          render: (_: unknown, row: IPlanChangeRequest) =>
            row.status === 'pending' && (
              <Space size={4}>
                <Popconfirm title={t('plan.change_approve')} onConfirm={() => handleApprove(row)}>
                  <Button size="small" type="primary" loading={approve.isPending}>
                    {t('plan.change_approve')}
                  </Button>
                </Popconfirm>
                <Button size="small" danger onClick={() => setRejecting(row)}>
                  {t('plan.change_reject')}
                </Button>
              </Space>
            ),
        }]
      : []),
  ];

  return (
    <Drawer open={open} onClose={onClose} width="min(1100px, 100vw)" title={t('plan.changes_title')}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as 'pending' | 'all')}
          options={[
            { label: t('plan.change_filter_pending'), value: 'pending' },
            { label: t('plan.change_filter_all'), value: 'all' },
          ]}
        />
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as 'week' | 'all')}
          options={[
            { label: t('plan.change_scope_week'), value: 'week' },
            { label: t('plan.change_scope_all'), value: 'all' },
          ]}
        />
      </Space>
      {isError && <Alert type="error" showIcon message={t('common.error')} style={{ marginBottom: 12 }} />}
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data?.results ?? []}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: t('plan.change_empty') }}
      />
      <Modal
        open={rejecting !== null}
        title={t('plan.change_reject')}
        onOk={handleReject}
        onCancel={closeReject}
        okButtonProps={{ danger: true, loading: reject.isPending }}
      >
        <Input.TextArea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('plan.change_reject_note_placeholder')}
        />
      </Modal>
    </Drawer>
  );
}
