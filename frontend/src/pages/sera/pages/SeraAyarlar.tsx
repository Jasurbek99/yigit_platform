import { useState } from 'react';
import { Button, Input, Select, Switch, Tag } from 'antd';
import {
  IconChevronDown, IconLayoutGrid, IconShieldLock, IconTrash, IconUser, IconUserPlus,
} from '@tabler/icons-react';
import { SeraPageHeader } from '../components/SeraPageHeader';
import { SeraCard } from '../components/SeraCard';
import { SERA } from '../seraTheme';
import { SERA_USERS, SERA_TOTAL_SECTIONS, type ISeraUser, type SeraUserRole } from '../mock/ayarlar';

const ROLE_OPTIONS: { value: SeraUserRole; label: string }[] = [
  { value: 'Ýolbaşçy', label: 'Ýolbaşçy' },
  { value: 'Görüji', label: 'Görüji' },
];

export default function SeraAyarlar() {
  const [users, setUsers] = useState<ISeraUser[]>([...SERA_USERS]);
  const [showAmounts, setShowAmounts] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const canAdd = newName.trim() !== '' && newLogin.trim() !== '' && newPassword.trim() !== '';

  const handleAdd = (): void => {
    if (!canAdd) return;
    const user: ISeraUser = {
      id: `u-${Date.now()}`,
      name: newName.trim(),
      login: newLogin.trim(),
      greeting: '',
      role: 'Görüji',
      sectionsGranted: 0,
    };
    setUsers((prev) => [user, ...prev]);
    setNewName('');
    setNewLogin('');
    setNewPassword('');
  };

  const handleRemove = (id: string): void => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const updateUser = (id: string, patch: Partial<ISeraUser>): void => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SeraPageHeader
        icon={<IconShieldLock size={22} />}
        title="Sazlamalar — Ulanyjylar we Ygtyýarlyk"
        subtitle="Ulanyjy sanawyny dörediň we her ulanyjynyň haýsy bölümleri görüp biljekdigini kesgitläň."
        accent={SERA.slate}
        accentDark="#1e293b"
      />

      {/* Baş Sahypa Sazlamalary */}
      <SeraCard
        title={(
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconLayoutGrid size={16} color={SERA.slate} /> Baş Sahypa Sazlamalary
          </span>
        )}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600, color: SERA.ink }}>San / Tutar görkezilişi</div>
            <div style={{ fontSize: 12, color: SERA.sub, marginTop: 2 }}>
              Ana Dasboard we Finans sahypalarynda takyk san/tutar görkezmek. Öçürilende diňe % görkezilýär.
            </div>
          </div>
          <Switch checked={showAmounts} onChange={setShowAmounts} />
        </div>
      </SeraCard>

      {/* Täze Ulanyjy Goş */}
      <SeraCard title="Täze Ulanyjy Goş">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Input
            placeholder="Ad Familiýa (mysal: Soltan Annayew)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Input
            placeholder="Giriş ady (mysal: soltan)"
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <Input.Password
            placeholder="Açar sözi"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
        </div>
        <Button
          type="primary"
          icon={<IconUserPlus size={15} />}
          disabled={!canAdd}
          onClick={handleAdd}
          style={{ marginTop: 12, background: canAdd ? SERA.slate : undefined, borderColor: canAdd ? SERA.slate : undefined }}
        >
          Goş
        </Button>
        <div style={{ fontSize: 12, color: SERA.sub, marginTop: 10 }}>
          Ýolbaşçy hasaby hemişe doly elýeterlilige eýedir we bu sanawdan dolandyrylmaz.
        </div>
      </SeraCard>

      {/* Ulanyjylar */}
      <SeraCard title={`Ulanyjylar (${users.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border: `1px solid ${SERA.line}`, borderRadius: 10, padding: 14, background: SERA.greenSoft }}
            >
              <span style={{ color: SERA.sub, marginTop: 6, flexShrink: 0 }}><IconUser size={16} /></span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <Input
                  value={u.name}
                  onChange={(e) => updateUser(u.id, { name: e.target.value })}
                  placeholder="Ad Soyad"
                />
                <Input
                  value={u.login}
                  onChange={(e) => updateUser(u.id, { login: e.target.value })}
                  placeholder="Giriş ady"
                  style={{ color: SERA.sub }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Input
                    value={u.greeting}
                    onChange={(e) => updateUser(u.id, { greeting: e.target.value })}
                    placeholder="Salamlaşma ady"
                    style={{ flex: 1, minWidth: 160 }}
                  />
                  <Tag color="default">Baş Sahypa</Tag>
                  <Input.Password placeholder="Şifre" style={{ flex: 1, minWidth: 140 }} />
                  <Select<SeraUserRole>
                    value={u.role}
                    onChange={(value) => updateUser(u.id, { role: value })}
                    options={ROLE_OPTIONS}
                    style={{ width: 130 }}
                  />
                  <Button type="text" size="small" style={{ color: SERA.sub, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {u.sectionsGranted}/{SERA_TOTAL_SECTIONS} bölüm <IconChevronDown size={14} />
                  </Button>
                  <Button type="text" danger icon={<IconTrash size={16} />} onClick={() => handleRemove(u.id)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </SeraCard>
    </div>
  );
}
