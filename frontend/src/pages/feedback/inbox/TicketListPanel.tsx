import { useCallback, useRef, useState } from 'react';
import { DatePicker, Empty, Flex, Input, Select, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useFeedbackTickets } from '@/hooks/useFeedback';
import { useAdminUsers } from '@/hooks/useAdmin';
import type { FeedbackCategory, FeedbackStatus } from '@/types';
import { TicketCard } from './TicketCard';

const { RangePicker } = DatePicker;

interface ITicketListPanelProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function TicketListPanel({ selectedId, onSelect }: ITicketListPanelProps): React.ReactElement {
  const { t } = useTranslation();
  // Raw search input updates on every keystroke; debounced value drives the API
  // 300ms after typing stops.
  const [searchInput, setSearchInput] = useState('');
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
            aria-label={t('feedback.filter.status_label')}
          />
          <Select
            value={category}
            onChange={(v) => setCategory(v as FeedbackCategory | '')}
            options={categoryOptions}
            size="small"
            style={{ flex: 1 }}
            aria-label={t('feedback.filter.category_label')}
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
          aria-label={t('feedback.filter.author_label')}
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
