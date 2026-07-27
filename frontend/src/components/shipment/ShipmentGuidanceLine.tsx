import { useTranslation } from 'react-i18next';
import { CheckCircleOutlined, EditOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { COLORS } from '@/constants/styles';
import type { IShipmentDetail } from '@/types';

interface IShipmentGuidanceLineProps {
  shipment: IShipmentDetail;
}

type GuideTone = 'task' | 'draft' | 'info';

const TONE_STYLE: Record<GuideTone, { bg: string; accent: string; icon: React.ReactNode }> = {
  task: { bg: COLORS.bgBlue, accent: COLORS.primary, icon: <CheckCircleOutlined style={{ color: COLORS.primary }} /> },
  draft: { bg: COLORS.bgGold, accent: COLORS.warning, icon: <EditOutlined style={{ color: COLORS.warning }} /> },
  info: { bg: COLORS.bgLight, accent: COLORS.borderLight, icon: <InfoCircleOutlined style={{ color: COLORS.textSecondary }} /> },
};

/**
 * One state-aware "what to do now" line under the hero. Grounded entirely in
 * existing shipment state (personal task / status code) — no invented domain
 * steps. A draft's empty destination fields are normal, so the draft message
 * explains that instead of leaving the screen reading as an abandoned form.
 */
export function ShipmentGuidanceLine({ shipment }: IShipmentGuidanceLineProps) {
  const { t } = useTranslation();

  const guide = ((): { text: string; tone: GuideTone } => {
    if (shipment.my_task) {
      return {
        text: t('shipment.detail.guide.your_task', { task: t(shipment.my_task.title_key) }),
        tone: 'task',
      };
    }
    if (shipment.status_code === 'draft') {
      return { text: t('shipment.detail.guide.draft'), tone: 'draft' };
    }
    if (shipment.status_code === 'cancelled') {
      return { text: t('shipment.detail.guide.cancelled'), tone: 'info' };
    }
    if (shipment.status_code === 'tamamlandy') {
      return { text: t('shipment.detail.guide.completed'), tone: 'info' };
    }
    return {
      text: t('shipment.detail.guide.active', { status: shipment.status_display }),
      tone: 'info',
    };
  })();

  const style = TONE_STYLE[guide.tone];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 6,
        background: style.bg,
        borderLeft: `3px solid ${style.accent}`,
        fontSize: 13,
        color: COLORS.textPrimary,
      }}
    >
      {style.icon}
      <span>{guide.text}</span>
    </div>
  );
}
