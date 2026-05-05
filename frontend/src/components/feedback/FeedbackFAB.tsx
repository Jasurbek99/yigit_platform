import { useState } from 'react';
import { FloatButton, Modal, Drawer, Grid } from 'antd';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconMessageCircle } from '@tabler/icons-react';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';

const { useBreakpoint } = Grid;

export function FeedbackFAB(): React.ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const screens = useBreakpoint();
  const [open, setOpen] = useState(false);

  const fromPath = location.pathname;

  const title = t('feedback.fab.modal_title');

  function handleClose(): void {
    setOpen(false);
  }

  const formContent = (
    <FeedbackForm
      fromPath={fromPath}
      onSuccess={handleClose}
      navigateOnSuccess={false}
    />
  );

  return (
    <>
      <FloatButton
        icon={<IconMessageCircle size={20} />}
        type="primary"
        tooltip={t('feedback.fab.tooltip')}
        onClick={() => setOpen(true)}
        style={{ bottom: 24, right: 24 }}
      />

      {screens.md ? (
        <Modal
          open={open}
          onCancel={handleClose}
          title={title}
          footer={null}
          width={600}
          destroyOnHidden
        >
          {formContent}
        </Modal>
      ) : (
        <Drawer
          open={open}
          onClose={handleClose}
          title={title}
          placement="bottom"
          height="90vh"
          destroyOnHidden
        >
          {formContent}
        </Drawer>
      )}
    </>
  );
}
