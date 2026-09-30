import { useTranslation } from 'react-i18next';
import { useShipmentOptions } from '@/hooks/useAdmin';
import type { IShipmentDraft } from '@/types';
import { COLORS } from '@/constants/styles';
import { cardDetails } from './assignmentHelpers';

/** The filled-details list shared by both Assignment board cards. */
export function CardDetails({ draft }: { draft: IShipmentDraft }) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language ?? 'tk';
  const { data: harvestOptions = [] } = useShipmentOptions('harvest_status');

  // harvest_status stores the option code; show the option's label in the UI language.
  function harvestLabel(code: string): string {
    const o = harvestOptions.find((x) => x.code === code);
    if (!o) return code;
    return lang.startsWith('ru') && o.label_ru ? o.label_ru
      : lang.startsWith('en') && o.label_en ? o.label_en : o.label_tk;
  }

  const details = cardDetails(draft, harvestLabel);
  if (details.length === 0) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45 }}>
      {details.map((d) => (
        <div key={d.key}>
          <span style={{ color: COLORS.textTertiary }}>{`${t(`assign.detail.${d.key}`)}:`}</span>{' '}
          <span>{d.value}</span>
        </div>
      ))}
    </div>
  );
}
