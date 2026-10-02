import { Button, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { useJoinBoard } from '@/hooks/useDrafts';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { canDoBackendGated } from '@/utils/permissions';
import { DailyPlanStrip } from '@/pages/export/assignment/DailyPlanStrip';
import { splitBoardColumns } from '@/pages/export/assignment/boardHelpers';

const { Text } = Typography;

interface IDailyExportModalProps {
  readonly onClose: () => void;
  /** The task's own link — the assignment board, where packing is joined. */
  readonly boardLink: string;
}

/**
 * «Eksport planla» opens this on My tasks instead of leaving the board
 * (owner, 2026-10-02): today's plan vs export parts with «+» per row, and the
 * export parts of today that still wait for packing. "Today" is the server's
 * day from daily-progress, not the browser's.
 */
export function DailyExportModal({ onClose, boardLink }: IDailyExportModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const { data: progress } = useDailyProgress();
  const { data: rows = [] } = useJoinBoard();
  const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;
  const waiting = splitBoardColumns(rows).waiting.filter((d) => d.date === progress?.date);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={t('tasks.daily_export_plan')}
      width={640}
      footer={<Button type="primary" onClick={() => go(boardLink)}>{t('assign.page_title')}</Button>}
    >
      <DailyPlanStrip canCreate={canCreate} />
      <Text strong>{t('tasks.daily_export_waiting', { count: waiting.length })}</Text>
      {waiting.length === 0 ? (
        <div><Text type="secondary">{t('tasks.daily_export_none_waiting')}</Text></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          {waiting.map((d) => (
            <Button key={d.id} type="link" style={{ padding: 0 }} onClick={() => go(`/shipments/${d.id}`)}>
              {[d.shipment_code, d.country_name, d.customer_name].filter(Boolean).join(' · ')}
            </Button>
          ))}
        </div>
      )}
    </Modal>
  );
}
