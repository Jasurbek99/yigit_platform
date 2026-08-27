import { Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

const LANGS = ['tk', 'ru', 'en'] as const;

export type LangCode = (typeof LANGS)[number];

interface ILocalizedFieldGroupProps {
  /** Draft values keyed by full field name (`label_tk`, `who_ru`, …). */
  values: Record<string, string>;
  /** Field-name prefix: `label` → label_tk/_ru/_en. */
  fieldPrefix: 'label' | 'who' | 'description';
  /**
   * i18n key of the canonical default (`sheet.row.harvest_block`), rendered as
   * the placeholder in each language. Null for custom rows and for tooltips,
   * which have no DEFAULT_SHEET_ROWS entry.
   */
  dottedKey: string | null;
  multiline?: boolean;
  disabled: boolean;
  onChange: (field: string, next: string) => void;
}

/**
 * The tk / ru / en trio for one localized field of a sheet row. Purely
 * controlled — it writes into the detail panel's draft, and the panel's Save
 * button is what sends the PATCH. When a saved value differs from the
 * canonical default, a small "default: X" hint sits under the input so the
 * admin can see what they overrode.
 */
export function LocalizedFieldGroup({
  values,
  fieldPrefix,
  dottedKey,
  multiline = false,
  disabled,
  onChange,
}: ILocalizedFieldGroupProps) {
  const { t, i18n } = useTranslation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {LANGS.map((lang) => {
        const field = `${fieldPrefix}_${lang}`;
        const value = values[field] ?? '';
        // `t` with an explicit `lng` resolves in that language without
        // switching the admin's own locale.
        const defaultText = dottedKey
          ? (i18n.t(dottedKey, { lng: lang, defaultValue: '' }) as string)
          : '';
        const showHint = !!defaultText && !!value && value !== defaultText;
        return (
          <div key={lang}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span
                style={{
                  width: 24,
                  fontSize: 11,
                  color: COLORS.textSecondary,
                  paddingTop: multiline ? 4 : 5,
                }}
              >
                {lang.toUpperCase()}
              </span>
              {multiline ? (
                <Input.TextArea
                  rows={2}
                  aria-label={field}
                  value={value}
                  disabled={disabled}
                  placeholder={defaultText || undefined}
                  onChange={(e) => onChange(field, e.target.value)}
                />
              ) : (
                <Input
                  aria-label={field}
                  value={value}
                  disabled={disabled}
                  placeholder={defaultText || undefined}
                  onChange={(e) => onChange(field, e.target.value)}
                />
              )}
            </div>
            {showHint && (
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.textSecondary,
                  marginLeft: 32,
                  marginTop: 2,
                }}
                title={defaultText}
              >
                {t('sheet_rows.default_hint', { value: defaultText })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
