import { useState } from 'react';
import { Drawer, Flex, Grid, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { TicketListPanel } from './inbox/TicketListPanel';
import { TicketDetailPanel } from './inbox/TicketDetailPanel';

const { Title } = Typography;
const { useBreakpoint } = Grid;

export default function AdminInboxPage(): React.ReactElement {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const isMobile = !screens.md;

  if (isMobile) {
    // Single column — selecting a ticket opens the detail in a Drawer.
    return (
      <div style={{ height: 'calc(100vh - 56px - 48px)', display: 'flex', flexDirection: 'column' }}>
        <Title level={4} style={{ margin: '0 0 12px' }}>
          {t('feedback.inbox.title')}
        </Title>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TicketListPanel selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <Drawer
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
          title={t('feedback.inbox.ticket_detail')}
          placement="right"
          width="100%"
          destroyOnHidden
        >
          <TicketDetailPanel ticketId={selectedId} />
        </Drawer>
      </div>
    );
  }

  // Desktop two-pane: 35% list, 65% detail.
  return (
    <div style={{ height: 'calc(100vh - 56px - 48px)', display: 'flex', flexDirection: 'column' }}>
      <Title level={4} style={{ margin: '0 0 12px', flexShrink: 0 }}>
        {t('feedback.inbox.title')}
      </Title>
      <Flex
        style={{
          flex: 1,
          overflow: 'hidden',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        <div
          style={{
            width: '35%',
            flexShrink: 0,
            borderRight: '1px solid #f0f0f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <TicketListPanel selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TicketDetailPanel ticketId={selectedId} />
        </div>
      </Flex>
    </div>
  );
}
