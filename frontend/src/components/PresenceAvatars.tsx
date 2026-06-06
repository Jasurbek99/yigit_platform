// PresenceAvatars — compact avatar row in the Sheet toolbar that, on click,
// opens a Google-Docs-style popover listing every current viewer.
//
// Read-only: roster comes straight from the realtime store (no fetch / no
// React Query). The current user appears first in both the inline group and
// the popover list with a "(you)" marker.

import { useState } from 'react';
import { Avatar, Popover, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeStore } from '@/stores/realtimeStore';
import type { IPresenceUser } from '@/types/presence';

const MAX_INLINE = 5;
const AVATAR_SIZE = 26;
const LIST_AVATAR_SIZE = 32;

const { Text } = Typography;

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
  const [open, setOpen] = useState(false);

  if (roster.length === 0) return null;

  // Self first, then by join time. Stable.
  const sorted = [...roster].sort((a, b) => {
    const aIsMe = user?.id === a.user_id ? -1 : 0;
    const bIsMe = user?.id === b.user_id ? -1 : 0;
    if (aIsMe !== bIsMe) return aIsMe - bIsMe;
    return a.joined_at.localeCompare(b.joined_at);
  });

  const popoverContent = (
    <div style={{ minWidth: 260, maxHeight: 360, overflowY: 'auto' }}>
      {sorted.map((p) => {
        const isMe = user?.id === p.user_id;
        const roleLabel = t(`roles.${p.role}`, { defaultValue: p.role });
        return (
          <div
            key={`${p.user_id}-${p.joined_at}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 4px',
            }}
          >
            <Avatar
              size={LIST_AVATAR_SIZE}
              style={{
                backgroundColor: p.color,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initials(p.name) || p.username.slice(0, 2).toUpperCase()}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: '#1f2937',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.name}
                {isMe && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                    ({t('presence.you')})
                  </Text>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{roleLabel}</div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const popoverTitle = (
    <span style={{ fontSize: 13, fontWeight: 600 }}>
      {t('presence.total_viewers', { count: roster.length })}
    </span>
  );

  return (
    <Popover
      content={popoverContent}
      title={popoverTitle}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
    >
      <span style={{ display: 'inline-flex', cursor: 'pointer' }}>
        <Avatar.Group
          max={{
            count: MAX_INLINE,
            style: { backgroundColor: '#94a3b8', color: '#fff', fontSize: 11 },
          }}
          size={AVATAR_SIZE}
        >
          {sorted.map((p) => {
            const isMe = user?.id === p.user_id;
            return (
              <Avatar
                key={`${p.user_id}-${p.joined_at}`}
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
            );
          })}
        </Avatar.Group>
      </span>
    </Popover>
  );
}
