import { useState, useEffect } from 'react';
import { Input, Select, Form, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useTomatoVarieties } from '@/hooks/useAdmin';
import { VarietySelect } from '@/components/VarietySelect';

// ─── Month abbreviation map (Soltanmyrat's dept standard, signed 15.04.2026) ──

const MONTH_OPTIONS = [
  { value: 'YA', label: 'YA (Ýan)' },
  { value: 'FB', label: 'FB (Few)' },
  { value: 'MR', label: 'MR (Mart)' },
  { value: 'AP', label: 'AP (Apr)' },
  { value: 'MY', label: 'MY (Maý)' },
  { value: 'IY', label: 'IY (Iýun)' },
  { value: 'IL', label: 'IL (Iýul)' },
  { value: 'AG', label: 'AG (Awg)' },
  { value: 'SP', label: 'SP (Sen)' },
  { value: 'OC', label: 'OC (Okt)' },
  { value: 'NO', label: 'NO (Noý)' },
  { value: 'DC', label: 'DC (Dek)' },
];

const MONTH_INDEX_TO_CODE: Record<number, string> = {
  1: 'YA', 2: 'FB', 3: 'MR', 4: 'AP', 5: 'MY', 6: 'IY',
  7: 'IL', 8: 'AG', 9: 'SP', 10: 'OC', 11: 'NO', 12: 'DC',
};

// ─── Types ─────────────────────────────────────────────────────────────────

interface IOfficialCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  platformId?: string | number | null;
}

interface ICodeFields {
  day: string;
  month: string;
  seq: string;
  block: string;
  year: string;
  /** variety code string (e.g. "08") — NOT the variety id */
  varietyCode: string;
  /** the variety id selected in VarietySelect — needed to look up the code */
  varietyId: number | null;
}

function parseValue(raw: string, varieties: Array<{ id: number; code: string | null }>): ICodeFields {
  if (!raw) {
    const now = dayjs();
    return {
      day: now.format('DD'),
      month: MONTH_INDEX_TO_CODE[now.month() + 1] ?? 'AP',
      seq: '',
      block: '',
      year: now.format('YY'),
      varietyCode: '',
      varietyId: null,
    };
  }
  const parts = raw.split('|');
  const vCode = parts[5] ?? '';
  const found = varieties.find((v) => v.code === vCode);
  return {
    day: parts[0] ?? '',
    month: parts[1] ?? '',
    seq: parts[2] ?? '',
    block: parts[3] ?? '',
    year: parts[4] ?? '',
    varietyCode: vCode,
    varietyId: found?.id ?? null,
  };
}

function buildJoined(fields: ICodeFields): string {
  const parts = [fields.day, fields.month, fields.seq, fields.block, fields.year, fields.varietyCode];
  // If all empty return empty string (no blank pipes)
  if (parts.every((p) => p === '')) return '';
  return parts.join('|');
}

// ─── Component ─────────────────────────────────────────────────────────────

export function OfficialCodeEditor({ value, onChange, platformId }: IOfficialCodeEditorProps) {
  const { t } = useTranslation();
  const { data: varieties = [] } = useTomatoVarieties();

  const [fields, setFields] = useState<ICodeFields>(() =>
    parseValue(value, varieties),
  );

  // Re-parse when value changes externally (e.g. reset)
  useEffect(() => {
    if (!value) {
      const now = dayjs();
      setFields({
        day: now.format('DD'),
        month: MONTH_INDEX_TO_CODE[now.month() + 1] ?? 'AP',
        seq: '',
        block: '',
        year: now.format('YY'),
        varietyCode: '',
        varietyId: null,
      });
    }
  // Only re-sync when value resets to empty (external reset)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === '']);

  function handleField<K extends keyof ICodeFields>(key: K, val: ICodeFields[K]) {
    const next = { ...fields, [key]: val };
    setFields(next);
    onChange(buildJoined(next));
  }

  function handleVarietyChange(id: number | null) {
    const v = varieties.find((vr) => vr.id === id);
    const code = v?.code ?? '';
    const next = { ...fields, varietyId: id, varietyCode: code };
    setFields(next);
    onChange(buildJoined(next));
  }

  const joined = buildJoined(fields);

  const inputStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    textAlign: 'center' as const,
  };

  return (
    <div>
      {/* 6-field grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 80px 80px 80px 60px 1fr',
          gap: 6,
          alignItems: 'flex-end',
        }}
      >
        {/* Day */}
        <Form.Item
          label={t('official_code.field_day')}
          style={{ margin: 0 }}
        >
          <Input
            value={fields.day}
            onChange={(e) => handleField('day', e.target.value.replace(/\D/g, '').slice(0, 2))}
            maxLength={2}
            placeholder="DD"
            style={inputStyle}
            size="small"
          />
        </Form.Item>

        {/* Month */}
        <Form.Item
          label={t('official_code.field_month')}
          style={{ margin: 0 }}
        >
          <Select
            value={fields.month || undefined}
            onChange={(v) => handleField('month', v ?? '')}
            options={MONTH_OPTIONS}
            size="small"
            style={{ width: '100%', fontFamily: 'monospace' }}
            allowClear
          />
        </Form.Item>

        {/* Sequence */}
        <Form.Item
          label={t('official_code.field_seq')}
          style={{ margin: 0 }}
        >
          <Input
            value={fields.seq}
            onChange={(e) => handleField('seq', e.target.value.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            placeholder="NNN"
            style={inputStyle}
            size="small"
          />
        </Form.Item>

        {/* Block/sub */}
        <Form.Item
          label={t('official_code.field_block')}
          style={{ margin: 0 }}
        >
          <Input
            value={fields.block}
            onChange={(e) =>
              handleField('block', e.target.value.toUpperCase().slice(0, 3))
            }
            maxLength={3}
            placeholder="A4"
            style={inputStyle}
            size="small"
          />
        </Form.Item>

        {/* Year */}
        <Form.Item
          label={t('official_code.field_year')}
          style={{ margin: 0 }}
        >
          <Input
            value={fields.year}
            onChange={(e) => handleField('year', e.target.value.replace(/\D/g, '').slice(0, 2))}
            maxLength={2}
            placeholder="YY"
            style={inputStyle}
            size="small"
          />
        </Form.Item>

        {/* Variety */}
        <Form.Item
          label={t('official_code.field_variety')}
          style={{ margin: 0 }}
        >
          <VarietySelect
            value={fields.varietyId}
            onChange={handleVarietyChange}
            size="small"
            allowClear
          />
        </Form.Item>
      </div>

      {/* Preview row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
          padding: '6px 10px',
          background: '#f5f5f5',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#8c8c8c', marginRight: 8 }}>
          {t('official_code.preview_label')}:
        </span>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1d1d1d', flex: 1 }}>
          {joined || '—'}
        </span>
        {platformId != null && (
          <Tag color="blue" style={{ fontFamily: 'monospace', marginLeft: 8 }}>
            {t('official_code.platform_id_label')}: {platformId}
          </Tag>
        )}
      </div>
    </div>
  );
}
