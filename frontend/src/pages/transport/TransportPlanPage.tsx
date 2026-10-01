import { useMemo } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, DatePicker, Empty, Space, Table, Tooltip, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAcknowledgeTask, useTransportPlan } from '@/hooks/usePlanAck';
import type { ITransportPlan } from '@/types';

dayjs.extend(isoWeek);
dayjs.extend(utc);
dayjs.extend(timezone);

// Greenhouse time — viewers on KZ/RU domain machines often run UTC.
const TM_TZ = 'Asia/Ashgabat';

const { Title, Text } = Typography;
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const CHANGED_BG = '#fff1b8';

/** Monday of the ISO week in ?week=&year=, else of the current week. */
function weekFromParams(params: URLSearchParams): Dayjs {
  const week = Number(params.get('week'));
  const year = Number(params.get('year'));
  if (week > 0 && year > 0) return dayjs(`${year}-01-04`).isoWeek(week).isoWeekday(1);
  return dayjs().isoWeekday(1);
}

interface IRow {
  destinationId: number;
  name: string;
}

/**
 * Truck Planning — docs/Tasks.md item 3. Read-only view of the week's
 * truck allocation (day × destination × trucks); cells that changed since
 * transport's last «Tanyşdym» are highlighted. The «Tanyşdym» button shows while
 * a transport_plan task is open and is the only way that task closes.
 */
export default function TransportPlanPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const monday = weekFromParams(params);
  const year = monday.isoWeekYear();
  const week = monday.isoWeek();
  const { data, isLoading } = useTransportPlan(year, week);
  const ack = useAcknowledgeTask();

  const cellMap = useMemo(() => {
    const map = new Map<string, ITransportPlan['cells'][number]>();
    for (const c of data?.cells ?? []) map.set(`${c.day_of_week}-${c.destination_id}`, c);
    return map;
  }, [data]);

  const rows: IRow[] = (data?.destinations ?? []).map((d) => ({ destinationId: d.id, name: d.name }));

  const columns = [
    { title: t('transport_plan.destination'), dataIndex: 'name', key: 'name', width: 180 },
    ...(data?.days ?? []).map((day) => ({
      title: `${t(`weekday.${WEEKDAY_KEYS[day.day_of_week - 1]}`)} ${dayjs(day.date).format('DD.MM')}`,
      key: `d${day.day_of_week}`,
      align: 'center' as const,
      render: (_: unknown, row: IRow) => {
        const cell = cellMap.get(`${day.day_of_week}-${row.destinationId}`);
        const count = cell?.truck_count ?? 0;
        const acknowledged = cell?.acknowledged_count ?? null;
        const changed = acknowledged != null && acknowledged !== count;
        const content = (
          <div
            data-testid={`cell-${day.day_of_week}-${row.destinationId}`}
            data-changed={String(changed)}
            style={{ background: changed ? CHANGED_BG : undefined, borderRadius: 4, padding: '2px 0' }}
          >
            {count}
          </div>
        );
        return changed
          ? <Tooltip title={t('transport_plan.was', { n: acknowledged })}>{content}</Tooltip>
          : content;
      },
    })),
  ];

  function onWeekChange(value: Dayjs | null) {
    if (!value) return;
    setParams({ week: String(value.isoWeek()), year: String(value.isoWeekYear()) });
  }

  const taskId = data?.open_task_id;
  const snapshot = data?.snapshot ?? '';

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('transport_plan.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {week} · {year} · {monday.format('DD.MM')}–{monday.add(5, 'day').format('DD.MM')}
          </Text>
        </div>
        <Space wrap>
          <Button
            icon={<LeftOutlined />}
            onClick={() => onWeekChange(monday.subtract(1, 'week'))}
            aria-label={t('plan.prev_week')}
          />
          <DatePicker picker="week" value={monday} onChange={onWeekChange} allowClear={false} />
          <Button
            icon={<RightOutlined />}
            onClick={() => onWeekChange(monday.add(1, 'week'))}
            aria-label={t('plan.next_week')}
          />
          {taskId != null && data?.can_acknowledge && (
            <Button type="primary" loading={ack.isPending} onClick={() => ack.mutate({ taskId, snapshot })}>
              {t('tasks.acknowledge')}
            </Button>
          )}
        </Space>
      </Space>
      {data?.acknowledged_at && (
        <Text type="secondary" style={{ display: 'block', margin: '8px 0' }}>
          {t('transport_plan.acknowledged_at', { time: dayjs(data.acknowledged_at).tz(TM_TZ).format('DD.MM HH:mm') })}
        </Text>
      )}
      {!isLoading && rows.length === 0 ? (
        <Empty description={t('transport_plan.empty')} />
      ) : (
        <Table<IRow>
          rowKey="destinationId"
          size="small"
          loading={isLoading}
          pagination={false}
          dataSource={rows}
          columns={columns}
          scroll={{ x: true }}
        />
      )}
    </Card>
  );
}
