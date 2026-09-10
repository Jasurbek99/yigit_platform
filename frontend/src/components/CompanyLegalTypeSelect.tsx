import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useCompanyLegalTypes } from '@/hooks/useAdmin';

interface ICompanyLegalTypeSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  /**
   * Narrow the list to forms valid in this country. Used by the import-firm
   * form so a Kazakh buyer is offered TOO / IP rather than a Turkmen HJ.
   * Leave undefined on the export side, where every firm is Turkmen.
   */
  countryId?: number | null;
  /**
   * Narrow by ISO country code instead of id. The export side has no country
   * FK to read — every export firm is Turkmen — so it passes "TM" and is
   * offered HJ / HT / HK rather than the whole twelve.
   */
  countryCode?: string;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

export function CompanyLegalTypeSelect({
  value,
  onChange,
  countryId,
  countryCode,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: ICompanyLegalTypeSelectProps) {
  const { t, i18n } = useTranslation();
  const { data: legalTypes = [] } = useCompanyLegalTypes(countryId);

  const options = legalTypes
    .filter((type) => type.is_active || type.id === value)
    // A form tagged with no country at all is offered everywhere.
    .filter(
      (type) =>
        !countryCode ||
        type.country_codes.length === 0 ||
        type.country_codes.includes(countryCode) ||
        type.id === value,
    )
    .map((type) => {
      const abbr = i18n.language.startsWith('ru')
        ? type.abbr_ru
        : i18n.language.startsWith('tk')
        ? type.abbr_tk
        : type.abbr_en || type.abbr_tk;
      const full = i18n.language.startsWith('ru')
        ? type.full_ru
        : i18n.language.startsWith('tk')
        ? type.full_tk
        : type.full_en || type.full_tk;
      // "HJ — Hojalyk jemgyýeti": the abbreviation is what staff recognise,
      // the full form is what disambiguates HJ from HK.
      return { value: type.id, label: `${abbr} — ${full}` };
    });

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('common.select_legal_type')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
