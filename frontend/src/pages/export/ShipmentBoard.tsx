import { useMemo, useState } from 'react';
import { Input, Select, Space, Typography, Spin, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { KanbanColumn } from '@/components/kanban/KanbanColumn';
import { ShipmentKanbanCard } from '@/components/kanban/ShipmentKanbanCard';
import { BoardTasksModal } from '@/components/kanban/BoardTasksModal';
import { SelfBoardTaskDrawer } from '@/components/kanban/SelfBoardTaskDrawer';
import { CountrySelect } from '@/components/CountrySelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { useShipmentBoard, type IBoardFilters, type IBoardItem } from '@/hooks/useShipmentBoard';
import { formatDuration } from '@/components/shipment/PhaseContextStrip.helpers';
import type { ITaskListItem, ShipmentPhase } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title } = Typography;

/** The 7 phases in display order. */
const PHASES: ShipmentPhase[] = ['PLAN', 'PREP', 'DOCS', 'LOAD', 'TRANSIT', 'DEST', 'CLOSE'];

/** Accent colour for each phase column header. */
const PHASE_ACCENT: Record<ShipmentPhase, string> = {
  PLAN: COLORS.textSecondary,
  PREP: COLORS.orange,
  DOCS: '#fadb14',
  LOAD: COLORS.primary,
  TRANSIT: '#13c2c2',
  DEST: COLORS.purple,
  CLOSE: COLORS.success,
  // CANCELLED is not rendered as a Kanban column (not in PHASES array).
  // The entry is required for the exhaustive Record type.
  CANCELLED: '#ff4d4f',
};

/** Static owner-role options for the filter dropdown. */
const OWNER_ROLE_OPTIONS = [
  'admin',
  'export_manager',
  'loading_dept_head',
  'loading_dept_head_deputy',
  'warehouse_chief',
  'weight_master',
  'document_team',
  'transport',
  'sales_rep',
  'finansist',
  'director',
  'accountant',
  'greenhouse_manager',
  'seller',
  'boss',
];

/** Gapy Satys filter — 3-state: undefined = any, true = yes, false = no. */
type GapySatysFilter = 'any' | 'yes' | 'no';

export default function ShipmentBoard() {
  const { t } = useTranslation();

  // ── Filter state ─────────────────────────────────────────────────────────
  const [country, setCountry] = useState<number | null>(null);
  const [customer, setCustomer] = useState<number | null>(null);
  const [gapySatys, setGapySatys] = useState<GapySatysFilter>('any');
  const [ownerRole, setOwnerRole] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const filters: IBoardFilters = {
    ...(country != null ? { country } : {}),
    ...(customer != null ? { customer } : {}),
    ...(gapySatys !== 'any' ? { gapy_satys: gapySatys === 'yes' } : {}),
    ...(ownerRole ? { owner_role: ownerRole } : {}),
    ...(search ? { search } : {}),
  };

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useShipmentBoard(filters);

  // ── Derived ──────────────────────────────────────────────────────────────
  const columns = data?.columns ?? {};
  const phaseAvgSeconds = data?.phase_avg_seconds ?? {};

  // ── Task modal + drawer state ──────────────────────────────────────────────
  // modalItemId is re-resolved against live board data each render so the modal
  // list reflects fresh task states after an action (the board query refetches).
  const [modalItemId, setModalItemId] = useState<number | null>(null);
  const [drawerTask, setDrawerTask] = useState<ITaskListItem | null>(null);

  const allItems = useMemo(
    () => Object.values(data?.columns ?? {}).flat() as IBoardItem[],
    [data?.columns],
  );
  const modalItem =
    modalItemId != null ? allItems.find((i) => i.id === modalItemId) ?? null : null;

  // ── Role options with i18n labels ─────────────────────────────────────────
  const roleOptions = [
    { value: '', label: t('shipment_board.filter_owner_role_all') },
    ...OWNER_ROLE_OPTIONS.map((r) => ({ value: r, label: t(`tasks.role.${r}`) })),
  ];

  // ── Gapy Satys options ────────────────────────────────────────────────────
  const gapySatysOptions = [
    { value: 'any', label: t('shipment_board.filter_gapy_any') },
    { value: 'yes', label: t('shipment_board.filter_gapy_yes') },
    { value: 'no', label: t('shipment_board.filter_gapy_no') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0 }}>
        <Title level={4} style={{ marginBottom: 12 }}>
          {t('shipment_board.title')}
        </Title>

        {/* Filters */}
        <Space wrap size={8}>
          <CountrySelect
            value={country}
            onChange={setCountry}
            placeholder={t('shipment_board.filter_country')}
            style={{ width: 160 }}
            size="small"
          />
          <CustomerSelect
            value={customer}
            onChange={setCustomer}
            placeholder={t('shipment_board.filter_customer')}
            style={{ width: 160 }}
            size="small"
          />
          <Select<GapySatysFilter>
            value={gapySatys}
            onChange={setGapySatys}
            options={gapySatysOptions}
            size="small"
            style={{ width: 130 }}
            placeholder={t('shipment_board.filter_gapy_satys')}
          />
          <Select<string>
            value={ownerRole ?? ''}
            onChange={(v) => setOwnerRole(v || undefined)}
            options={roleOptions}
            size="small"
            style={{ width: 180 }}
            placeholder={t('shipment_board.filter_owner_role')}
            showSearch
            filterOption={(input, option) =>
              (String(option?.label ?? '')).toLowerCase().includes(input.toLowerCase())
            }
          />
          <Input.Search
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onSearch={(v) => setSearch(v)}
            placeholder={t('shipment_board.filter_search')}
            allowClear
            size="small"
            style={{ width: 200 }}
          />
        </Space>
      </div>

      {/* ── Board ──────────────────────────────────────────────────────── */}
      {isError && (
        <Alert type="error" message={t('common.load_error')} style={{ flexShrink: 0 }} />
      )}

      {isLoading ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin size="large" />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            flex: 1,
            alignItems: 'flex-start',
            paddingBottom: 16,
          }}
        >
          {PHASES.map((phase) => {
            const items = columns[phase] ?? [];
            const avgSeconds = phaseAvgSeconds[phase];
            const phaseKey = phase.toLowerCase() as Lowercase<ShipmentPhase>;

            const footer =
              avgSeconds != null ? (
                <div
                  style={{
                    padding: '6px 8px',
                    borderTop: '1px solid #f0f0f0',
                    fontSize: 11,
                    color: COLORS.textSecondary,
                    flexShrink: 0,
                    textAlign: 'center',
                  }}
                >
                  {t('shipment_board.avg_in_phase', { duration: formatDuration(avgSeconds) })}
                </div>
              ) : null;

            return (
              <div
                key={phase}
                style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}
              >
                <KanbanColumn
                  title={t(`phase.${phaseKey}`)}
                  count={items.length}
                  accentColor={PHASE_ACCENT[phase]}
                  emptyText={t('shipment_board.empty_phase')}
                >
                  {items.map((item) => (
                    <ShipmentKanbanCard
                      key={item.id}
                      item={item}
                      onTasksClick={(it) => setModalItemId(it.id)}
                    />
                  ))}
                </KanbanColumn>
                {footer}
              </div>
            );
          })}
        </div>
      )}

      {/* Task list modal. Hidden (but its shipment id retained) while the task
          drawer is open, so the two overlays never stack — stacking an
          interactive Drawer over an antd Modal breaks the drawer's focus trap.
          Closing the drawer brings the list back, re-resolved from live data. */}
      <BoardTasksModal
        item={drawerTask != null ? null : modalItem}
        onClose={() => setModalItemId(null)}
        onTaskClick={(task) => setDrawerTask(task)}
      />

      {/* Shared "do the task" surface — same drawer used on /me/board. */}
      <SelfBoardTaskDrawer task={drawerTask} onClose={() => setDrawerTask(null)} />
    </div>
  );
}
