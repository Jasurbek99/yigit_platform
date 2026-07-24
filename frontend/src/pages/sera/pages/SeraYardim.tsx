import { useState } from 'react';
import { Input, Button } from 'antd';
import { IconMessageCircle, IconSend2 } from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SERA } from '../seraTheme';

const EXAMPLE_QUESTIONS: readonly string[] = [
  '770 howzy nähili paýlanýar?',
  'Önümçilik maglumaty nireden gelýär?',
  'Girdeji (satuw) nähili hasaplanýar?',
  'Häzirki wagtda iň ýokary çykdajyly blok haýsy?',
  'Jemi näçe işgärimiz bar?',
  'Häzirki wagtda haýsy blogymyz iň girdejili?',
];

interface IChatMessage {
  readonly id: number;
  readonly text: string;
}

export default function SeraYardim() {
  const [messages, setMessages] = useState<readonly IChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  function sendQuestion(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => [...prev, { id: Date.now(), text: trimmed }]);
    setDraft('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconMessageCircle size={22} />}
        title="Kömek — Programma Sorag-Jogap"
        subtitle="Hasaplama mantygy barada umumy soraglar berip bilersiňiz, ýa-da programmadaky hakyky maglumatlaryňyza esaslanyp anyk soraglar berip bilersiňiz (mes. 'iň girdejili blok haýsy')."
        accent="#0b5e3f"
        accentDark="#083d29"
      />

      <SeraCard title="Köp soralýan mysallar">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => sendQuestion(q)}
              style={{
                border: `1px solid ${SERA.green}`,
                background: SERA.greenSoft,
                color: SERA.greenDark,
                borderRadius: 20,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </SeraCard>

      <SeraCard>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 12px 32px' }}>
            <IconMessageCircle size={40} color={SERA.line} style={{ marginBottom: 12 }} />
            <div style={{ color: SERA.sub, fontSize: 14 }}>
              Heniz sorag berilmedi. Ýokardaky mysallardan birini saýlaň ýa-da öz soragyňyzy aşakda ýazyň.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    background: SERA.green,
                    color: '#fff',
                    borderRadius: '14px 14px 2px 14px',
                    padding: '10px 14px',
                    maxWidth: '70%',
                    fontSize: 13.5,
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: messages.length === 0 ? 24 : 0 }}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={() => sendQuestion(draft)}
            placeholder="Sorunuzu yazın… (örn. '730 we 760 arasyndaky tapawut näme?')"
            size="large"
          />
          <Button
            type="primary"
            size="large"
            icon={<IconSend2 size={15} />}
            disabled={!draft.trim()}
            onClick={() => sendQuestion(draft)}
            style={{ background: SERA.green, borderColor: SERA.green }}
          >
            Iber
          </Button>
        </div>
      </SeraCard>

      <div style={{ fontSize: 12.5, color: SERA.sub, lineHeight: 1.6 }}>
        Bu söhbet, hem programmanyň hasaplama mantygyny, hem-de häzirki hakyky maglumatlaryňyzy (ähli bloklar,
        önümçilik, satuw, işgärler, çykdajylar) bilýän emeli aň kömekçisi tarapyndan jogaplandyrylýar. Möhüm
        çözgütler üçin maslahatçyňyza ýa-da developere ýüz tutmagyňyz maslahat berilýär.
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: SERA.sub, marginTop: 8 }}>
        Maglumatlar bu enjamda/hasapda saklanýar we beýleki ulanyjylar bilen paýlaşylmaýar.
      </div>
    </div>
  );
}
