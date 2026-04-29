import { Drawer, Segmented, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSheetStore } from '@/stores/sheetStore';
import { CommentList } from './CommentList';
import { CommentComposer } from './CommentComposer';

const { Text } = Typography;

interface ICommentsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CommentsDrawer({ open, onClose }: ICommentsDrawerProps) {
  const { t } = useTranslation();
  const {
    commentsShipmentId,
    commentsFilter,
    setCommentsFilter,
  } = useSheetStore();

  const hasFieldKey = Boolean(commentsFilter.fieldKey);

  type SegmentValue = 'cell' | 'all' | 'my_tasks';

  const activeSegment: SegmentValue =
    commentsFilter.assigneeMe
      ? 'my_tasks'
      : commentsFilter.fieldKey
        ? 'cell'
        : 'all';

  const handleSegmentChange = (val: string | number) => {
    const v = val as SegmentValue;
    if (v === 'cell') {
      setCommentsFilter({ fieldKey: commentsFilter.fieldKey });
    } else if (v === 'all') {
      setCommentsFilter({});
    } else {
      setCommentsFilter({ assigneeMe: true });
    }
  };

  const segmentOptions = [
    ...(hasFieldKey ? [{ label: t('comments.filter_this_cell'), value: 'cell' }] : []),
    { label: t('comments.filter_all_cells'), value: 'all' },
    { label: t('comments.filter_my_tasks'), value: 'my_tasks' },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('comments.title')}
      placement="right"
      width={360}
      mask={false}
      getContainer={false}
      style={{ position: 'absolute' }}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {/* Filter chips */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
        <Segmented
          options={segmentOptions}
          value={activeSegment}
          onChange={handleSegmentChange}
          size="small"
          style={{ width: '100%' }}
        />
      </div>

      {/* Body */}
      {commentsShipmentId != null ? (
        <>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <CommentList
              shipmentId={commentsShipmentId}
              filter={commentsFilter}
            />
          </div>

          <CommentComposer shipmentId={commentsShipmentId} />
        </>
      ) : (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('comments.no_shipment_selected')}
          </Text>
        </div>
      )}
    </Drawer>
  );
}
