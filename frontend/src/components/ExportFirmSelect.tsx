import { Select } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';
import { useQuotaFirmBalances } from '@/hooks/useQuotaDashboard';
import { buildSearchBlob, normalizeSearch } from '@/utils/normalizeSearch';
import { firmHasNoQuota } from '@/utils/quotaFirms';
import { QuotaPageLink } from '@/components/QuotaPageLink';

interface IExportFirmSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  /** IDs to exclude from the options list (e.g. already selected in other rows). */
  excludeIds?: number[];
  /**
   * Opt in to the export-quota gate: firms with no quota left are tagged and
   * disabled, and the dropdown offers a link to the quota page. Only for
   * pickers that assign a firm to a truck (draft creation, firm splits) —
   * contract screens pick a firm for other reasons and must stay unfiltered.
   */
  checkQuota?: boolean;
}

interface IFirmOption {
  value: number;
  label: string;
  searchBlob: string;
  disabled?: boolean;
}

/**
 * Self-fetching Select for ExportFirm reference data.
 * Searchable by code + name_tk + name_ru + name_en (punctuation- and
 * diacritic-insensitive). Label shows code and Turkmen name.
 */
export function ExportFirmSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
  excludeIds = [],
  checkQuota = false,
}: IExportFirmSelectProps) {
  const { t } = useTranslation();
  const { data: firms = [], isLoading } = useAdminFirms();
  // 'tomato' like every other caller: no picker carries a product type and
  // pepper is a rare separate quota domain.
  const { data: balances } = useQuotaFirmBalances('tomato', { enabled: checkQuota });

  const options = useMemo<IFirmOption[]>(
    () =>
      firms
        .filter((f) => f.is_active && !excludeIds.includes(f.id))
        .map((f) => {
          const displayName = f.name_tk || f.name_ru || f.name_en || f.code;
          const label = f.code ? `${displayName} · ${f.code}` : displayName;
          const blocked = checkQuota && firmHasNoQuota(balances, f.id);
          return {
            value: f.id,
            label: blocked ? `${label} ⚠ ${t('sheet.firm_no_quota_tag')}` : label,
            // Hard block, matching the server. The firm already chosen here
            // stays selectable so a pre-filled blocked firm can't wedge the
            // field.
            disabled: blocked && f.id !== value,
            searchBlob: buildSearchBlob([
              f.code,
              f.name_tk,
              f.name_ru,
              f.name_en,
            ]),
          };
        }),
    [firms, excludeIds, checkQuota, balances, value, t],
  );

  // Read from the balances, NOT from `disabled`: the firm currently selected
  // in this row is never disabled, and when it is the only blocked one the row
  // would otherwise offer no way out — the dead end this link exists to remove.
  const hasBlockedFirm =
    checkQuota && options.some((o) => firmHasNoQuota(balances, o.value));

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      loading={isLoading}
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('common.select_export_firm')}
      size={size}
      style={style}
      filterOption={(input, option) => {
        const needle = normalizeSearch(input);
        if (!needle) return true;
        return (option as unknown as IFirmOption).searchBlob.includes(needle);
      }}
      popupRender={
        hasBlockedFirm
          ? (menu) => (
              <>
                {menu}
                <div
                  style={{
                    borderTop: '1px solid #f0f0f0',
                    padding: '4px 8px',
                    display: 'flex',
                    justifyContent: 'flex-start',
                  }}
                  // Keep the mousedown from blurring the Select before the
                  // anchor's click runs (it does not cancel the anchor's own
                  // default, so the new tab still opens).
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <QuotaPageLink />
                </div>
              </>
            )
          : undefined
      }
    />
  );
}
