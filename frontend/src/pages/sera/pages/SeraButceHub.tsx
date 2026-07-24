import { useNavigate } from 'react-router-dom';
import {
  IconLayoutGrid, IconCalendar, IconClipboardList, IconPlant2, IconUsers,
  IconFlask, IconBox, IconReceipt2, IconShoppingCart, IconBuilding,
  IconReportAnalytics, IconFileInvoice, IconShoppingBag, IconChartBar, IconSettings,
  IconMessageCircle, IconChevronDown,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraSectionCard } from '../components/SeraSectionCard';
import { SERA } from '../seraTheme';
import { SERA_BUTCE_SECTIONS } from '../seraNav';

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <IconLayoutGrid size={20} />,
  calendar: <IconCalendar size={20} />,
  clipboard: <IconClipboardList size={20} />,
  plant: <IconPlant2 size={20} />,
  users: <IconUsers size={20} />,
  flask: <IconFlask size={20} />,
  box: <IconBox size={20} />,
  receipt: <IconReceipt2 size={20} />,
  cart: <IconShoppingCart size={20} />,
  building: <IconBuilding size={20} />,
  report: <IconReportAnalytics size={20} />,
  invoice: <IconFileInvoice size={20} />,
  shopping: <IconShoppingBag size={20} />,
  chart: <IconChartBar size={20} />,
  settings: <IconSettings size={20} />,
};

export default function SeraButceHub() {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconFileInvoice size={22} />}
        title="Býujet"
        subtitle="Sera býujetiniň ähli bölümlerine bu ýerden giriş"
      />

      {/* Ask bar (decorative) */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderRadius: 12, background: SERA.card, border: `1px solid ${SERA.line}`,
          color: SERA.green, fontWeight: 500, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconMessageCircle size={18} /> Býujet barada sorag ber — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Section grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {SERA_BUTCE_SECTIONS.map((s) => (
          <SeraSectionCard
            key={s.slug}
            icon={ICONS[s.icon]}
            label={s.label}
            iconColor={s.color}
            onClick={() => navigate(`/sera/butce/${s.slug}`)}
          />
        ))}
      </div>
    </div>
  );
}
