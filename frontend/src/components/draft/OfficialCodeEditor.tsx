import { useState, useEffect } from 'react';
import { Input, Select, Form, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { COLORS, FONT } from '@/constants/styles';

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
}

function emptyFields(): ICodeFields {
  const now = dayjs();
  return {
    day: now.format('DD'),
    month: MONTH_INDEX_TO_CODE[now.month() + 1] ?? 'AP',
    seq: '',
    block: '',
    year: now.format('YY'),
  };
}

function parseValue(raw: string): ICodeFields {
  if (!raw) return emptyFields();
  const parts = raw.split('|');
  return {
    day: parts[0] ?? '',
    month: parts[1] ?? '',
    seq: parts[2] ?? '',
    block: parts[3] ?? '',
    year: parts[4] ?? '',
  };
}

function buildJoined(fields: ICodeFields): string {
  const { day, month, seq, block, year } = fields;
  if ([day, month, seq, block, year].every((p) => p === '')) return '';
  // The stored code always has 6 '|'-separated fields (backend validator
  // requires exactly 6). The 6th — variety — stays empty in drafts; the
  // weight master records it per pallet at packaging.
  return [day, month, seq, block, year, ''].join('|');
}

// ─── Component ─────────────────────────────────────────────────────────────

export function OfficialCodeEditor({ value, onChange, platformId }: IOfficialCodeEditorProps) {
  const { t } = useTranslation();

  const [fields, setFields] = useState<ICodeFields>(() => parseValue(value));

  // Re-sync only when value is reset to empty externally (e.g. form reset).
  useEffect(() => {
    if (!value) setFields(emptyFields());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === '']);

  function handleField<K extends keyof ICodeFields>(key: K, val: ICodeFields[K]) {
    const next = { ...fields, [key]: val };
    setFields(next);
    onChange(buildJoined(next));
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: FONT.mono,
    textAlign: 'center' as const,
  };

  const segments: Array<{ key: keyof ICodeFields; label: string; value: string }> = [
    { key: 'day', label: t('official_code.field_day'), value: fields.day },
    { key: 'month', label: t('official_code.field_month'), value: fields.month },
    { key: 'seq', label: t('official_code.field_seq'), value: fields.seq },
    { key: 'block', label: t('official_code.field_block'), value: fields.block },
    { key: 'year', label: t('official_code.field_year'), value: fields.year },
  ];

  return (
    <div>
      {/* 5-field grid — labels stack above each input so nothing truncates */}
      <Form layout="vertical" component={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '64px 104px 92px 92px 64px',
            gap: 8,
          }}
        >
          {/* Day */}
          <Form.Item label={t('official_code.field_day')} style={{ margin: 0 }}>
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
          <Form.Item label={t('official_code.field_month')} style={{ margin: 0 }}>
            <Select
              value={fields.month || undefined}
              onChange={(v) => handleField('month', v ?? '')}
              options={MONTH_OPTIONS}
              size="small"
              style={{ width: '100%', fontFamily: FONT.mono }}
              allowClear
            />
          </Form.Item>

          {/* Sequence */}
          <Form.Item
            label={t('official_code.field_seq')}
            tooltip={t('official_code.field_seq_hint')}
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
            tooltip={t('official_code.field_block_hint')}
            style={{ margin: 0 }}
          >
            <Input
              value={fields.block}
              onChange={(e) => handleField('block', e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              placeholder="A4"
              style={inputStyle}
              size="small"
            />
          </Form.Item>

          {/* Year */}
          <Form.Item label={t('official_code.field_year')} style={{ margin: 0 }}>
            <Input
              value={fields.year}
              onChange={(e) => handleField('year', e.target.value.replace(/\D/g, '').slice(0, 2))}
              maxLength={2}
              placeholder="YY"
              style={inputStyle}
              size="small"
            />
          </Form.Item>
        </div>
      </Form>

      {/* Preview — each field as its own labelled slot, never a raw pipe string.
          Empty slots read as blanks to fill, not as punctuation. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 10,
          padding: '8px 12px',
          background: COLORS.bgLight,
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ fontSize: 11, color: COLORS.textSecondary, marginRight: 2, paddingBottom: 4 }}>
            {t('official_code.preview_label')}:
          </span>
          {segments.map((seg) => (
            <div key={seg.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  minWidth: 34,
                  padding: '3px 8px',
                  textAlign: 'center',
                  fontFamily: FONT.mono,
                  fontWeight: 600,
                  fontSize: 13,
                  lineHeight: 1.2,
                  borderRadius: 4,
                  border: `1px solid ${COLORS.borderLight}`,
                  background: seg.value ? COLORS.white : COLORS.bgLayout,
                  color: seg.value ? COLORS.textDark : COLORS.textMuted,
                }}
              >
                {seg.value || '—'}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: COLORS.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}
              >
                {seg.label}
              </span>
            </div>
          ))}
        </div>
        {platformId != null && (
          <Tag color="blue" style={{ fontFamily: FONT.mono, margin: 0 }}>
            {t('official_code.platform_id_label')}: {platformId}
          </Tag>
        )}
      </div>
    </div>
  );
}
