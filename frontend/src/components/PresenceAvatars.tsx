// PresenceAvatars — Ant Avatar.Group showing who is on the Sheet right now.
//
// Reads the roster directly from the realtime store (no fetch / no React
// Query). The current user appears first with a "(you)" marker, dimmed so
// they recognise themselves. Up to 5 avatars are shown inline; the rest
// collapse into a "+N" overflow chip with a tooltip-able popover.

import { Avatar, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeStore } from '@/stores/realtimeStore';
import type { IPresenceUser } from '@/types/presence';

const MAX_INLINE = 5;
const AVATAR_SIZE = 26;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface IPresenceAvatarsProps {
  /** Optional override (defaults to the global sheet roster). */
  roster?: IPresenceUser[];
}

export function PresenceAvatars({ roster: rosterProp }: IPresenceAvatarsProps = {}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const globalRoster = useRealtimeStore((s) => s.sheetRoster);
  const roster = rosterProp ?? globalRoster;

  if (roster.length === 0) return null;

  // Sort: self first (when present), then by joined_at ascending — stable.
  const sorted = [...roster].sort((a, b) => {
    const aIsMe = user?.id === a.user_id ? -1 : 0;
    const bIsMe = user?.id === b.user_id ? -1 : 0;
    if (aIsMe !== bIsMe) return aIsMe - bIsMe;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return (
    <Tooltip title={t('presence.viewing_now')} placement="bottom">
      <Avatar.Group
        max={{
          count: MAX_INLINE,
          style: { backgroundColor: '#94a3b8', color: '#fff', fontSize: 11 },
        }}
        size={AVATAR_SIZE}
      >
        {sorted.map((p) => {
          const isMe = user?.id === p.user_id;
          const roleLabel = t(`roles.${p.role}`, { defaultValue: p.role });
          const displayName = isMe ? `${p.name} (${t('presence.you')})` : p.name;
          return (
            <Tooltip
              key={`${p.user_id}-${p.joined_at}`}
              title={t('presence.tooltip_role', { name: displayName, role: roleLabel })}
              placement="bottom"
            >
              <Avatar
                style={{
                  backgroundColor: p.color,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: isMe ? 0.65 : 1,
                  border: '2px solid #fff',
                }}
                size={AVATAR_SIZE}
              >
                {initials(p.name) || p.username.slice(0, 2).toUpperCase()}
              </Avatar>
            </Tooltip>
          );
        })}
      </Avatar.Group>
    </Tooltip>
  );
}
