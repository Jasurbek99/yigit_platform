import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Alert, DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';

import { DocumentPacketPanel } from '@/components/DocumentPacketPanel';
import { useDocumentPackets } from '@/hooks/useDocumentPackets';
import type { IDocumentPacket } from '@/types';

/**
 * Documents page — truck-indexed packet workspace for the document team. Each
 * truck row expands to its packet (truck CMR + per-firm invoice/letters).
 */
export default function DocumentsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const date = searchParams.get('date') ?? undefined;
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('page_size')) || 50;

  const { data, isLoading, error } = useDocumentPackets({ date, page, pageSize });
  const packets = data?.results ?? [];
  const total = data?.count ?? 0;

  const setDate = (value?: string): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('date', value);
      else next.delete('date');
      next.delete('page');
      return next;
    });
  };

  const columns: ProColumns<IDocumentPacket>[] = [
    { title: t('documents_page.column.code'), dataIndex: 'shipment_code', width: 130 },
    {
      title: t('documents_page.column.date'),
      dataIndex: 'date',
      width: 110,
      render: (_, r) => (r.date ? dayjs(r.date).format('DD.MM.YYYY') : '—'),
    },
    {
      title: t('documents_page.column.route'),
      dataIndex: 'country_name',
      width: 180,
      render: (_, r) => [r.country_name, r.city_name].filter(Boolean).join(', ') || '—',
    },
    {
      title: t('documents_page.column.buyer'),
      dataIndex: 'buyer_name',
      width: 140,
      render: (_, r) => r.buyer_name || '—',
    },
    {
      title: t('documents_page.column.status'),
      dataIndex: 'status_display',
      width: 120,
      render: (_, r) => (r.status_display ? <Tag>{r.status_display}</Tag> : '—'),
    },
    {
      title: t('documents_page.column.ready'),
      dataIndex: 'is_ready',
      width: 140,
      render: (_, r) =>
        r.is_ready ? (
          <Tag color="green">{t('documents_page.ready')}</Tag>
        ) : (
          <Tag color="orange">{t('documents_page.setup_needed')}</Tag>
        ),
    },
  ];

  if (error) {
    return <Alert type="error" showIcon message={t('documents_page.load_error')} />;
  }

  return (
    <ProTable<IDocumentPacket>
      rowKey="id"
      headerTitle={t('documents_page.title')}
      dataSource={packets}
      columns={columns}
      loading={isLoading}
      search={false}
      options={false}
      size="small"
      scroll={{ x: 'max-content' }}
      bordered
      expandable={{ expandedRowRender: (record) => <DocumentPacketPanel packet={record} /> }}
      pagination={{
        current: page,
        pageSize,
        total,
        pageSizeOptions: ['25', '50', '100', '200'],
        showSizeChanger: true,
        showTotal: (n) => t('documents_page.pagination_total', { total: n }),
        onChange: (p, ps) => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('page', String(p));
            next.set('page_size', String(ps));
            return next;
          });
        },
      }}
      toolBarRender={() => [
        <DatePicker
          key="date"
          value={date ? dayjs(date) : null}
          onChange={(d) => setDate(d ? d.format('YYYY-MM-DD') : undefined)}
          placeholder={t('documents_page.filter_date')}
        />,
      ]}
    />
  );
}
