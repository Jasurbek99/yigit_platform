import { useNavigate } from 'react-router-dom';
import { IconTrendingUp, IconMessageCircle, IconChevronDown, IconReportAnalytics } from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraSectionCard } from '../components/SeraSectionCard';
import { SERA } from '../seraTheme';

export default function SeraFinansHasabatlar() {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconReportAnalytics size={22} />}
        title="Maliýe Hasabatlar"
        subtitle="Maliýe hasabatlaryna we deňeşdirmelere bu ýerden giriş"
        accent="#0e7490"
        accentDark="#0a5866"
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
          <IconMessageCircle size={18} /> Maliýe hasabatlary barada sorag ber — nähili hasaplanýar, maglumatlar nireden gelýär?
        </span>
        <IconChevronDown size={18} />
      </div>

      {/* Section grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <SeraSectionCard
          icon={<IconTrendingUp size={20} />}
          label="Býujet Deňeşdirme (Girdeji)"
          iconColor="#0e7490"
          onClick={() => navigate('/sera/finans-hasabatlar/butce-karsilastirma')}
        />
      </div>
    </div>
  );
}
