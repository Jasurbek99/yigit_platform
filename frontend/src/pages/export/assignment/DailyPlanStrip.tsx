import { useState } from 'react';
import { Button, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { useCreateExportPart } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { COLORS } from '@/constants/styles';
import type { IDailyProgressDay, IDailyProgressRow } from '@/types';

const { Text } = Typography;

interface IDailyPlanStripProps {
  /** shipment.create is held and the season is writable. */
  readonly canCreate: boolean;
}

/**
 * Top of /export/assign (spec 2026-10-01): today's truck plan against the
 * export parts opened, «+» per plan row, and the Mon–Sat week on demand.
 * "Today" is the server's day (response `date`), not the browser's.
 */
export function DailyPlanStrip({ canCreate }: IDailyPlanStripProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useDailyProgress();
  const createPart = useCreateExportPart();
  const [showWeek, setShowWeek] = useState(false);

  const today = data?.days?.find((d) => d.date === data.date);
  if (!data || !today) return null;

  function add(row: IDailyProgressRow) {
    createPart.mutate(row.is_gapy ? { isGapy: true } : { country: row.country_id }, {
      onSuccess: (part) => navigate(`/shipments/${part.id}`),
      onError: (err) => toast.error(extractPatchError(err, t('assign.add_export_part_failed'))),
    });
  }

  return (
    <div style={{ background: COLORS.white, border: '1px solid #f0f0f0', borderRadius: 8,
      padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Text strong>{t('assign.today_plan')}:</Text>
        {today.rows.length === 0 && <Text type="secondary">{t('assign.no_plan_today')}</Text>}
        {today.rows.map((row) => (
          <span key={row.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: row.fact >= row.plan ? COLORS.success : undefined }}>
              {`${row.label} ${row.fact}/${row.plan}`}
            </Text>
            {canCreate && (
              <Button
                size="small"
                icon={<PlusOutlined />}
                aria-label={`${t('assign.add_export_part')}: ${row.label}`}
                disabled={createPart.isPending}
                onClick={() => add(row)}
              />
            )}
          </span>
        ))}
        <Text type="secondary">
          {t('tasks.progress_packing', { done: today.export_parts_packed, total: today.export_parts })}
        </Text>
        <Button type="link" size="small" onClick={() => setShowWeek((v) => !v)}>
          {t('assign.week_plan')}
        </Button>
      </div>
      {showWeek && <WeekTable days={data.days} todayDate={data.date} />}
    </div>
  );
}

function WeekTable({ days, todayDate }: { readonly days: IDailyProgressDay[]; readonly todayDate: string }) {
  const labels = new Map<string, string>();
  for (const d of days) for (const r of d.rows) if (!labels.has(r.key)) labels.set(r.key, r.label);
  const shade = (date: string) => (date === todayDate ? COLORS.bgLayout : undefined);
  const cell = (d: IDailyProgressDay, key: string) => {
    const r = d.rows.find((x) => x.key === key);
    return r ? `${r.fact}/${r.plan}` : '—';
  };

  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table data-testid="plan-week" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d.date} style={{ padding: '2px 8px', background: shade(d.date) }}>
                {dayjs(d.date).format('DD.MM')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...labels].map(([key, label]) => (
            <tr key={key}>
              <td style={{ paddingRight: 8 }}>{label}</td>
              {days.map((d) => (
                <td key={d.date} style={{ padding: '2px 8px', textAlign: 'center', background: shade(d.date) }}>
                  {cell(d, key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
