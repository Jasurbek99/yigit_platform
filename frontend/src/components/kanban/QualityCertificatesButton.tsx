import { Button } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { sectionAnchorFor } from '@/components/shipment/ShipmentCompletenessBar.helpers';
import { useStartTask } from '@/hooks/useTaskActions';
import type { ITaskListItem } from '@/types';

interface IQualityCertificatesButtonProps {
  task: ITaskListItem;
  shipmentId: number;
}

/**
 * «Upload certificates» on the quality task card (owner 2026-10-01): opens the
 * shipment at its certificate slots. Pressing it is what starts the task, and
 * the task's «Done» stays off — card and server — until it is started.
 */
export function QualityCertificatesButton({ task, shipmentId }: IQualityCertificatesButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const startMutation = useStartTask();

  function openCertificates(): void {
    navigate(`/shipments/${shipmentId}#${sectionAnchorFor('quality.azyk_maglumatnama')}`);
  }

  function handleClick(): void {
    if (task.state !== 'open') {
      openCertificates();
      return;
    }
    startMutation.mutate(
      { taskId: task.id, shipmentId },
      { onSuccess: openCertificates, onError: () => toast.error(t('common.error')) },
    );
  }

  return (
    <Button icon={<UploadOutlined />} onClick={handleClick} loading={startMutation.isPending}>
      {t('tasks.upload_certificates')}
    </Button>
  );
}
