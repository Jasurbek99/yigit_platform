import { useState } from 'react';
import {
  Table,
  DatePicker,
  Tag,
  Skeleton,
  Alert,
  Flex,
  Typography,
  Button,
  Space,
  Card,
  Statistic,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useDailyBoard, useUpsertDailyBoard } from '@/hooks/useDailyBoard';
import { DailyBoardNumberCell, DailyBoardTextCell } from '@/components/DailyBoardCell';
import type { IDailyBoardRow } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

type EditableField = 'today_plan' | 'yesterday_rest' | 'note';

function num(value: string | null): number {
  return value == null || value === '' ? 0 : Number(value);
}

function fmtKg(value: number | null): string {
  if (value == null || value === 0) return '—';
  return Number(value).toLocaleString();
}

// Summary/aggregate totals: 0 is meaningful data, render it as "0" not as the
// "no data entered" em-dash that per-cell fmtKg uses.
function fmtKgTotal(value: number): string {
  return Number(value).toLocaleString();
}

export default function DailyHarvestBoard() {
  const { t } = useTranslation();

  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs());
  const [savingBlocks, setSavingBlocks] = useState<Set<number>>(new Set());

  const dateStr = selectedDate.format('YYYY-MM-DD');
  const { data, isLoading, isError } = useDailyBoard(dateStr);
  const upsert = useUpsertDailyBoard();

  const rows = data?.results ?? [];
  const season = data?.season ?? null;

  // ─── Totals ───────────────────────────────────────────────────────────────
  const totalRest = rows.reduce((s, r) => s + num(r.yesterday_rest), 0);
  const totalPlan = rows.reduce((s, r) => s + num(r.today_plan), 0);
  const totalAll = totalRest + totalPlan;

  // ─── Handlers ───────────────────────────────────────────────────────────────
  function handleSave(block: number, field: EditableField, value: number | string | null): void {
    setSavingBlocks((s) => new Set(s).add(block));
    upsert.mutate(
      { block, date: dateStr, [field]: value },
      {
        onSuccess: () => toast.success(t('harvest_board.saved')),
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string } } };
          toast.error(apiErr?.response?.data?.error ?? t('harvest_board.save_error'));
        },
        onSettled: () =>
          setSavingBlocks((s) => {
            const next = new Set(s);
            next.delete(block);
            return next;
          }),
      },
    );
  }

  // ─── Columns ────────────────────────────────────────────────────────────────
  const columns: TableColumnsType<IDailyBoardRow> = [
    {
      title: t('harvest_board.block'),
      key: 'block',
      fixed: 'left',
      width: 150,
      render: (_, row) => (
        <div>
          <Tag color="blue">{row.block_code}</Tag>
          {row.block_name && (
            <div style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
              {row.block_name}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('harvest_board.yesterday_rest'),
      key: 'yesterday_rest',
      width: 150,
      render: (_, row) => (
        <DailyBoardNumberCell
          value={row.yesterday_rest}
          disabled={!season}
          saving={savingBlocks.has(row.block)}
          onCommit={(v) => handleSave(row.block, 'yesterday_rest', v)}
        />
      ),
    },
    {
      title: t('harvest_board.today_plan'),
      key: 'today_plan',
      width: 180,
      render: (_, row) => (
        <DailyBoardNumberCell
          value={row.today_plan}
          disabled={!season}
          saving={savingBlocks.has(row.block)}
          onCommit={(v) => handleSave(row.block, 'today_plan', v)}
        />
      ),
    },
    {
      title: t('harvest_board.total'),
      key: 'total',
      width: 120,
      render: (_, row) => (
        <strong style={{ color: COLORS.primary }}>{fmtKg(num(row.total))}</strong>
      ),
    },
    {
      title: t('harvest_board.note'),
      key: 'note',
      width: 260,
      render: (_, row) => (
        <DailyBoardTextCell
          value={row.note}
          disabled={!season}
          saving={savingBlocks.has(row.block)}
          placeholder={t('harvest_board.note_placeholder')}
          onCommit={(v) => handleSave(row.block, 'note', v)}
        />
      ),
    },
    {
      title: t('harvest_board.entered_at'),
      key: 'entered_at',
      width: 130,
      responsive: ['lg'],
      render: (_, row) =>
        row.entered_at ? (
          <Text style={{ fontSize: 12 }}>{dayjs(row.entered_at).format('DD.MM HH:mm')}</Text>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('harvest_board.entered_by'),
      key: 'entered_by',
      width: 130,
      responsive: ['lg'],
      render: (_, row) => row.entered_by_name ?? <span style={{ color: COLORS.textMuted }}>—</span>,
    },
  ];

  function renderSummary() {
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>{t('harvest_board.total_row')}</Table.Summary.Cell>
        <Table.Summary.Cell index={1}>{fmtKgTotal(totalRest)}</Table.Summary.Cell>
        <Table.Summary.Cell index={2}>{fmtKgTotal(totalPlan)}</Table.Summary.Cell>
        <Table.Summary.Cell index={3}>
          <strong style={{ color: COLORS.primary }}>{fmtKgTotal(totalAll)}</strong>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={4} />
        <Table.Summary.Cell index={5} />
        <Table.Summary.Cell index={6} />
      </Table.Summary.Row>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('harvest_board.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {selectedDate.format('DD.MM.YYYY')} · {rows.length} {t('harvest_board.blocks')}
            {season && <span> · {season.name}</span>}
          </Text>
        </div>
        <Space>
          <Button
            icon={<LeftOutlined />}
            onClick={() => setSelectedDate((d) => d.subtract(1, 'day'))}
            aria-label={t('harvest_board.prev_day')}
          />
          <DatePicker
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
            allowClear={false}
            format="DD.MM.YYYY"
            style={{ width: 150 }}
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => setSelectedDate((d) => d.add(1, 'day'))}
            aria-label={t('harvest_board.next_day')}
          />
          <Button onClick={() => setSelectedDate(dayjs())}>{t('harvest_board.today')}</Button>
        </Space>
      </Flex>

      {!season && !isLoading && (
        <Alert type="warning" showIcon message={t('harvest_board.no_season')} style={{ marginBottom: 16 }} />
      )}
      {isError && (
        <Alert type="error" message={t('harvest_board.save_error')} style={{ marginBottom: 16 }} />
      )}

      <Flex gap={12} style={{ marginBottom: 16 }}>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('harvest_board.yesterday_rest')}
            value={totalRest}
            suffix="kg"
            styles={{ content: { color: COLORS.textSecondary, fontSize: 18 } }}
            formatter={(v) => Number(v).toLocaleString()}
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('harvest_board.today_plan')}
            value={totalPlan}
            suffix="kg"
            styles={{ content: { color: COLORS.success, fontSize: 18 } }}
            formatter={(v) => Number(v).toLocaleString()}
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={t('harvest_board.total')}
            value={totalAll}
            suffix="kg"
            styles={{ content: { color: COLORS.primary, fontSize: 18 } }}
            formatter={(v) => Number(v).toLocaleString()}
          />
        </Card>
      </Flex>

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table<IDailyBoardRow>
          columns={columns}
          dataSource={rows}
          rowKey="block"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderSummary}
        />
      )}
    </div>
  );
}
