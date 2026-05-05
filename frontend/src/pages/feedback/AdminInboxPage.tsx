import { useState, useRef, useCallback } from 'react';
import {
  Input,
  Select,
  DatePicker,
  Flex,
  Typography,
  Tag,
  Divider,
  Image,
  Empty,
  Spin,
  Space,
  Drawer,
  Grid,
} from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { TicketStatusTag } from '@/components/feedback/TicketStatusTag';
import { ReplyComposer } from '@/components/feedback/ReplyComposer';
import { pathToLabel } from '@/components/feedback/pathLabels';
import {
  useFeedbackTickets,
  useFeedbackTicketDetail,
  useUpdateTicketStatus,
} from '@/hooks/useFeedback';
import { useAdminUsers } from '@/hooks/useAdmin';
import type { IFeedbackTicket, IFeedbackReply, FeedbackStatus, FeedbackCategory } from '@/types';

const { Title, Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;
const { RangePicker } = DatePicker;

// ─── Ticket list card ─────────────────────────────────────────────────────────

interface ITicketCardProps {
  ticket: IFeedbackTicket;
  isSelected: boolean;
  onClick: () => void;
}

function TicketCard({ ticket, isSelected, onClick }: ITicketCardProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderRadius: 6,
        background: isSelected ? '#e6f4ff' : '#fff',
        borderLeft: isSelected ? '3px solid #1677ff' : '3px solid transparent',
        borderBottom: '1px solid #f0f0f0',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text
          strong
          style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {ticket.title}
        </Text>
        <TicketStatusTag status={ticket.status} />
      </div>
      <div style={{ marginTop: 4 }}>
        <Space size={4}>
          <Tag style={{ fontSize: 11, padding: '0 4px' }}>{ticket.category_display}</Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>{ticket.author_name}</Text>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {dayjs(ticket.last_activity_at).format('DD.MM.YYYY HH:mm')}
      </Text>
    </div>
  );
}

// ─── Left panel ───────────────────────────────────────────────────────────────

interface ILeftPanelProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function TicketListPanel({ selectedId, onSelect }: ILeftPanelProps): React.ReactElement {
  const { t } = useTranslation();
  // Raw search input (updates on every keystroke for controlled input)
  const [searchInput, setSearchInput] = useState('');
  // Debounced search value sent to the API (updates 300ms after typing stops)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [author, setAuthor] = useState<number | ''>('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  const { data: usersData } = useAdminUsers();

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  }, []);

  const { data, isLoading } = useFeedbackTickets({
    scope: 'all',
    status: status || undefined,
    category: category || undefined,
    author: author || undefined,
    search: debouncedSearch || undefined,
    date_from: dateRange?.[0] || undefined,
    date_to: dateRange?.[1] || undefined,
  });

  const tickets = data?.results ?? [];

  const statusOptions = [
    { value: '', label: t('feedback.filter.all_statuses') },
    { value: 'new', label: t('feedback.status.new') },
    { value: 'in_review', label: t('feedback.status.in_review') },
    { value: 'resolved', label: t('feedback.status.resolved') },
    { value: 'rejected', label: t('feedback.status.rejected') },
  ];

  const categoryOptions = [
    { value: '', label: t('feedback.filter.all_categories') },
    { value: 'bug', label: t('feedback.category.bug') },
    { value: 'suggestion', label: t('feedback.category.suggestion') },
    { value: 'question', label: t('feedback.category.question') },
  ];

  const authorOptions = [
    { value: '', label: t('feedback.filter.all_authors') },
    ...(usersData ?? []).map((u) => ({
      value: u.id,
      label: u.first_name ? `${u.first_name} ${u.last_name}`.trim() : u.username,
    })),
  ];

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Filter bar */}
      <div style={{ padding: '12px 12px 0', flexShrink: 0 }}>
        <Input.Search
          placeholder={t('feedback.filter.search')}
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          onSearch={(val) => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            setDebouncedSearch(val);
          }}
          allowClear
          size="small"
          style={{ marginBottom: 8 }}
        />
        <Flex gap={6} style={{ marginBottom: 8 }}>
          <Select
            value={status}
            onChange={(v) => setStatus(v as FeedbackStatus | '')}
            options={statusOptions}
            size="small"
            style={{ flex: 1 }}
          />
          <Select
            value={category}
            onChange={(v) => setCategory(v as FeedbackCategory | '')}
            options={categoryOptions}
            size="small"
            style={{ flex: 1 }}
          />
        </Flex>
        <Select
          value={author}
          onChange={(v) => setAuthor(v as number | '')}
          options={authorOptions}
          size="small"
          style={{ width: '100%', marginBottom: 8 }}
          showSearch
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
        <RangePicker
          size="small"
          style={{ width: '100%', marginBottom: 8 }}
          onChange={(_, dateStrings) => {
            if (dateStrings[0] && dateStrings[1]) {
              setDateRange([dateStrings[0], dateStrings[1]]);
            } else {
              setDateRange(null);
            }
          }}
        />
      </div>

      {/* Ticket list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Spin />
          </div>
        )}
        {!isLoading && tickets.length === 0 && (
          <div style={{ padding: 20 }}>
            <Empty description={t('feedback.inbox.empty')} />
          </div>
        )}
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            isSelected={selectedId === ticket.id}
            onClick={() => onSelect(ticket.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Reply thread sub-component ───────────────────────────────────────────────

interface ITicketReplyThreadProps {
  replies: IFeedbackReply[];
}

function TicketReplyThread({ replies }: ITicketReplyThreadProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (replies.length === 0) return null;

  return (
    <>
      <Divider style={{ margin: '16px 0 8px' }} />
      <Text strong style={{ fontSize: 13 }}>
        {t('feedback.ticket.replies')} ({replies.length})
      </Text>
      <div style={{ marginTop: 8 }}>
        {replies.map((reply) => (
          <div
            key={reply.id}
            style={{
              background: reply.is_internal ? '#fffbe6' : '#f9f9f9',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
              borderLeft: reply.is_internal
                ? '3px solid #faad14'
                : reply.is_public
                ? '3px solid #1677ff'
                : '3px solid #d9d9d9',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Space size={6}>
                <Text strong style={{ fontSize: 12 }}>
                  {reply.author_name}
                </Text>
                {reply.is_internal && (
                  <Tag color="gold" style={{ fontSize: 10, padding: '0 4px' }}>
                    {t('feedback.reply.mode_internal')}
                  </Tag>
                )}
                {reply.is_public && (
                  <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                    {t('feedback.reply.mode_public')}
                  </Tag>
                )}
              </Space>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {dayjs(reply.created_at).format('DD.MM.YYYY HH:mm')}
              </Text>
            </div>
            <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {reply.content}
            </Paragraph>
            {reply.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <Image.PreviewGroup>
                  {reply.attachments.map((att) => (
                    <Image
                      key={att.id}
                      src={att.file}
                      width={60}
                      height={60}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                      alt={att.original_filename}
                    />
                  ))}
                </Image.PreviewGroup>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Right panel ──────────────────────────────────────────────────────────────

interface IRightPanelProps {
  ticketId: number | null;
}

function TicketDetailPanel({ ticketId }: IRightPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { data: ticket, isLoading } = useFeedbackTicketDetail(ticketId);
  const updateStatus = useUpdateTicketStatus(ticketId ?? 0);

  if (!ticketId) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Empty description={t('feedback.inbox.select_ticket')} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin />
      </div>
    );
  }

  if (!ticket) return <Empty />;

  const statusOptions = [
    { value: 'new', label: t('feedback.status.new') },
    { value: 'in_review', label: t('feedback.status.in_review') },
    { value: 'resolved', label: t('feedback.status.resolved') },
    { value: 'rejected', label: t('feedback.status.rejected') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scrollable detail area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Header */}
        <div style={{ marginBottom: 12 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color="blue">{ticket.category_display}</Tag>
            <Select
              value={ticket.status}
              options={statusOptions}
              size="small"
              style={{ width: 140 }}
              loading={updateStatus.isPending}
              onChange={(val) => updateStatus.mutate(val)}
            />
          </Space>
          <Title level={5} style={{ margin: '8px 0 4px' }}>
            {ticket.title}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {ticket.author_name} ({t(`roles.${ticket.author_role}`)})
            {ticket.submitted_from_path && ` — ${pathToLabel(ticket.submitted_from_path, t)}`}
            {' · '}
            {dayjs(ticket.created_at).format('DD.MM.YYYY HH:mm')}
          </Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Description */}
        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {ticket.description}
        </Paragraph>

        {/* Attachments */}
        {ticket.attachments.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Text strong style={{ fontSize: 12 }}>
              {t('feedback.ticket.attachments')}
            </Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <Image.PreviewGroup>
                {ticket.attachments.map((att) => (
                  <Image
                    key={att.id}
                    src={att.file}
                    width={80}
                    height={80}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    alt={att.original_filename}
                  />
                ))}
              </Image.PreviewGroup>
            </div>
          </>
        )}

        {/* Reply thread */}
        <TicketReplyThread replies={ticket.replies} />
      </div>

      {/* Reply composer — fixed at bottom */}
      <ReplyComposer ticketId={ticket.id} />
    </div>
  );
}

// ─── Admin Inbox Page ─────────────────────────────────────────────────────────

export default function AdminInboxPage(): React.ReactElement {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const isMobile = !screens.md;

  if (isMobile) {
    // Mobile: single column — list, select opens detail in a Drawer
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

  // Desktop: two-pane layout using Flex
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
        {/* Left pane — 35% */}
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

        {/* Right pane — 65% */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TicketDetailPanel ticketId={selectedId} />
        </div>
      </Flex>
    </div>
  );
}
