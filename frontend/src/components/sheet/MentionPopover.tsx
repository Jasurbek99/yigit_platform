import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IMentionable } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import i18n from '@/i18n';
import { COLORS } from '@/constants/styles';

interface ICellOption {
  fieldKey: string;
  label: string;
}

type Mode = 'users-or-roles' | 'cells';

interface IMentionPopoverProps {
  open: boolean;
  mode: Mode;
  query: string;
  users: Extract<IMentionable, { type: 'user' }>[];
  roles: Extract<IMentionable, { type: 'role' }>[];
  isLoading: boolean;
  onPick: (token: string, displayText: string, id?: number) => void;
  onClose: () => void;
}

function getCellOptions(query: string): ICellOption[] {
  // Read rows from the Zustand store (populated by ShipmentSheet on API load).
  const rows = useSheetStore.getState().rows;
  const q = query.toLowerCase();
  return rows.filter((row) => {
    if (row.input_type === 'comment_count') return false;
    const label = i18n.t(row.label_key);
    return !q || label.toLowerCase().includes(q) || row.field_key.toLowerCase().includes(q);
  }).map((row) => ({ fieldKey: row.field_key, label: i18n.t(row.label_key) }));
}

export function MentionPopover({
  open,
  mode,
  query,
  users,
  roles,
  isLoading,
  onPick,
  onClose,
}: IMentionPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string>('users');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const cellOptions = mode === 'cells' ? getCellOptions(query) : [];
  const currentList =
    mode === 'cells'
      ? cellOptions
      : activeKey === 'users'
        ? users
        : roles;

  // Reset index when list changes
  useEffect(() => { setSelectedIdx(0); }, [activeKey, users.length, roles.length, cellOptions.length]);

  const handlePick = useCallback((item: (typeof currentList)[number]) => {
    if (mode === 'cells') {
      const cell = item as ICellOption;
      onPick(`#cell:${cell.fieldKey}`, cell.label);
    } else if (activeKey === 'users') {
      const user = item as Extract<IMentionable, { type: 'user' }>;
      onPick(`@user:${user.id}`, user.name, user.id);
    } else {
      const role = item as Extract<IMentionable, { type: 'role' }>;
      onPick(`@role:${role.code}`, role.label);
    }
    onClose();
  }, [mode, activeKey, onPick, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const len = currentList.length;
      if (len === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % len);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + len) % len);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = currentList[selectedIdx];
        if (!item) return;
        handlePick(item);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, currentList, selectedIdx, onClose, handlePick]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  if (!open) return null;

  // Position below textarea
  const style: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    zIndex: 1050,
    background: COLORS.white,
    border: '1px solid #d9d9d9',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    width: 260,
    maxHeight: 240,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const listStyle: React.CSSProperties = {
    overflowY: 'auto',
    flex: 1,
  };

  const itemBase: React.CSSProperties = {
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  if (mode === 'cells') {
    return (
      <div ref={popoverRef} style={style}>
        <div style={{ padding: '4px 8px', fontSize: 11, color: COLORS.textSecondary, borderBottom: '1px solid #f0f0f0' }}>
          {t('comments.mention_cell')}
        </div>
        <div style={listStyle}>
          {isLoading && <div style={{ padding: 8 }}><Spin size="small" /></div>}
          {cellOptions.map((cell, idx) => (
            <div
              key={cell.fieldKey}
              style={{ ...itemBase, background: idx === selectedIdx ? '#f0f5ff' : undefined }}
              onMouseDown={(e) => { e.preventDefault(); handlePick(cell); }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>#</span>
              <span>{cell.label}</span>
            </div>
          ))}
          {cellOptions.length === 0 && !isLoading && (
            <div style={{ padding: '8px 12px', color: COLORS.textSecondary, fontSize: 12 }}>—</div>
          )}
        </div>
      </div>
    );
  }

  const tabItems = [
    {
      key: 'users',
      label: t('comments.tab_users'),
      children: (
        <div style={listStyle}>
          {isLoading && <div style={{ padding: 8 }}><Spin size="small" /></div>}
          {users.map((u, idx) => (
            <div
              key={u.id}
              style={{ ...itemBase, background: activeKey === 'users' && idx === selectedIdx ? '#f0f5ff' : undefined }}
              onMouseDown={(e) => { e.preventDefault(); handlePick(u); }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              <span
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: COLORS.primary, color: COLORS.white,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}
              >
                {u.name[0].toUpperCase()}
              </span>
              <span>{u.name}</span>
              <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>{u.role}</span>
            </div>
          ))}
          {users.length === 0 && !isLoading && (
            <div style={{ padding: '8px 12px', color: COLORS.textSecondary, fontSize: 12 }}>—</div>
          )}
        </div>
      ),
    },
    {
      key: 'roles',
      label: t('comments.tab_roles'),
      children: (
        <div style={listStyle}>
          {roles.map((r, idx) => (
            <div
              key={r.code}
              style={{ ...itemBase, background: activeKey === 'roles' && idx === selectedIdx ? '#f0f5ff' : undefined }}
              onMouseDown={(e) => { e.preventDefault(); handlePick(r); }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              <span style={{ color: COLORS.purple, fontWeight: 600 }}>@</span>
              <span>{r.label}</span>
              <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>
                {t('comments.role_member_count', { count: r.member_count })}
              </span>
            </div>
          ))}
          {roles.length === 0 && (
            <div style={{ padding: '8px 12px', color: COLORS.textSecondary, fontSize: 12 }}>—</div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div ref={popoverRef} style={style}>
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={tabItems}
        size="small"
        style={{ padding: '0 4px' }}
        tabBarStyle={{ marginBottom: 0 }}
      />
    </div>
  );
}
