import { Button, Tag } from 'antd';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useApproveSalesReport } from '@/hooks/useSalesReport';
import type { ISalesReport } from '@/types';

dayjs.extend(utc);
dayjs.extend(timezone);
const TM_TZ = 'Asia/Ashgabat';

/** Mirrors the backend gate on POST /shipments/{id}/sales-report/approve/. */
const APPROVE_ROLES = new Set(['export_manager', 'admin', 'boss', 'director']);

interface ISalesReportApprovalProps {
  readonly shipmentId: string;
  readonly report: ISalesReport | null | undefined;
  readonly role: string | undefined;
  readonly isSuperuser: boolean;
}

/**
 * «Hasabaty gözden geçir we tassykla» (docs/Tasks.md item 37). Either export
 * manager (or admin / boss / director) approves the report; approval closes the
 * shipment. Approve only — remarks go through comments. Once approved, shows who
 * and when.
 */
export function SalesReportApproval({ shipmentId, report, role, isSuperuser }: ISalesReportApprovalProps) {
  const { t } = useTranslation();
  const approve = useApproveSalesReport(shipmentId);

  if (!report) return null;

  if (report.approved_at) {
    return (
      <Tag color="success">
        {t('sales_report.approved_by', {
          name: report.approved_by_name ?? '—',
          time: dayjs(report.approved_at).tz(TM_TZ).format('DD.MM HH:mm'),
        })}
      </Tag>
    );
  }

  if (!isSuperuser && !APPROVE_ROLES.has(role ?? '')) return null;

  return (
    <Button
      type="primary"
      loading={approve.isPending}
      onClick={() => approve.mutate(undefined, {
        onSuccess: () => toast.success(t('sales_report.approve_success')),
        onError: () => toast.error(t('sales_report.approve_error')),
      })}
    >
      {t('sales_report.approve')}
    </Button>
  );
}
