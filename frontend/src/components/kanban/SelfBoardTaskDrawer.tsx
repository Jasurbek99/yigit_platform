import { Alert, Divider, Drawer, Skeleton, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { SelfBoardShipmentFieldList } from './SelfBoardShipmentFieldList';
import { OtherShipmentDetails } from './OtherShipmentDetails';
import { DrawerOpenInFullPageLink } from './DrawerOpenInFullPageLink';
import { ReadOnlyTaskSummary } from './ReadOnlyTaskSummary';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useShipmentSheet } from '@/hooks/useShipmentSheet';
import { useSheetStore } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { SUPERVISOR_ROLES } from '@/utils/detailSections';
import type {
  IRowConfig,
  ISheetRowSettingForUser,
  IShipmentDetail,
  IShipmentSheetItem,
  ITaskListItem,
  ShipmentPhase,
} from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

const PHASE_TAG_COLOR: Record<ShipmentPhase, string> = {
  PLAN: 'default',
  PREP: 'orange',
  DOCS: 'gold',
  LOAD: 'blue',
  TRANSIT: 'cyan',
  DEST: 'purple',
  CLOSE: 'green',
  CANCELLED: 'red',
};

interface ISelfBoardTaskDrawerProps {
  task: ITaskListItem | null;
  onClose: () => void;
}

export function SelfBoardTaskDrawer({
  task,
  onClose,
}: ISelfBoardTaskDrawerProps): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setEditingCell } = useSheetStore();

  const { data: shipment, isLoading: isDetailLoading, isError } = useShipmentDetail(
    task?.shipment,
  );

  // ── Ownership check — mirrors backend IsTaskActor ──────────────────────
  // A task is "yours" (and thus shows the active editing panel) when:
  //   1. you are the specific assigned user, OR
  //   2. you hold the assignee role, OR
  //   3. you are a supervisor (export_manager / boss / admin / director) —
  //      backend IsTaskActor allows supervisors to act on ANY task.
  // This fixes the bug where supervisors (my_task=null) and multi-task users
  // always fell through to the dead-end ReadOnlyTaskSummary.
  const isActiveState =
    task != null &&
    (task.state === 'open' || task.state === 'in_progress' || task.state === 'blocked');

  const isSupervisor = SUPERVISOR_ROLES.has(user?.role ?? '');

  const isOwnOrSupervised =
    user != null &&
    task != null &&
    (task.assignee_user === user.id || task.assignee_role === user.role || isSupervisor);

  const isActiveCard = isActiveState && isOwnOrSupervised;

  function handleOpenShipment(): void {
    if (task == null) return;
    navigate(`/shipments/${task.shipment}`);
  }

  // Clear any stale editing state from the Sheet page when the drawer closes,
  // so a SheetCellEditor that was open in the field list doesn't persist.
  function handleClose(): void {
    setEditingCell(null);
    onClose();
  }

  return (
    <Drawer
      open={task != null}
      onClose={handleClose}
      placement="right"
      width={480}
      destroyOnClose
      title={
        task != null && (
          <Space size={8}>
            <Tag color={PHASE_TAG_COLOR[task.phase]} style={{ margin: 0 }}>
              {task.phase}
            </Tag>
            <Text strong>{t(task.title_key)}</Text>
          </Space>
        )
      }
    >
      {task == null ? null : isDetailLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : isError || !shipment ? (
        <Alert type="error" message={t('common.error')} />
      ) : (
        <>
          <ShipmentCodeHeader
            cargoCode={shipment.cargo_code}
            officialCode={shipment.official_export_code}
          />
          <Divider style={{ margin: '12px 0' }} />
          {isActiveCard ? (
            <ActiveDrawerLayout
              task={task}
              shipment={shipment}
              onComplete={handleClose}
              onOpenShipment={handleOpenShipment}
            />
          ) : (
            <>
              <ReadOnlyTaskSummary task={task} />
              <DrawerOpenInFullPageLink onOpen={handleOpenShipment} />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

// ─── Shipment code identity header ────────────────────────────────────────────

interface IShipmentCodeHeaderProps {
  cargoCode: string;
  officialCode: string | null;
}

function ShipmentCodeHeader({
  cargoCode,
  officialCode,
}: IShipmentCodeHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Space size={16} wrap>
      <div>
        <Text
          style={{
            fontSize: 11,
            color: COLORS.textSecondary,
            fontWeight: 600,
            display: 'block',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 2,
          }}
        >
          {t('me.board.drawer_system_code')}
        </Text>
        <Text style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 15 }}>
          {cargoCode}
        </Text>
      </div>

      <div>
        <Text
          style={{
            fontSize: 11,
            color: COLORS.textSecondary,
            fontWeight: 600,
            display: 'block',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 2,
          }}
        >
          {t('me.board.drawer_official_code')}
        </Text>
        {officialCode != null ? (
          <Text style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 15 }}>
            {officialCode}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 15 }}>
            —
          </Text>
        )}
      </div>
    </Space>
  );
}

// ─── Active drawer layout ─────────────────────────────────────────────────────

interface IActiveDrawerLayoutProps {
  task: ITaskListItem;
  shipment: IShipmentDetail;
  onComplete: () => void;
  onOpenShipment: () => void;
}

function ActiveDrawerLayout({
  task,
  shipment,
  onComplete,
  onOpenShipment,
}: IActiveDrawerLayoutProps): React.ReactElement {
  const { t } = useTranslation();

  // useShipmentSheet is called here (not in the parent) so the expensive
  // full-season GET /export/shipments/sheet/ is only triggered when the
  // drawer is opened for an active, owned task — not for read-only cards.
  const { data: sheetData, isLoading: isSheetLoading } = useShipmentSheet();
  const sheetItem: IShipmentSheetItem | null =
    sheetData?.shipments.find((s) => s.id === task.shipment) ?? null;
  const sheetRows: IRowConfig[] = sheetData?.rows ?? [];
  const sheetRowSettings: Record<string, ISheetRowSettingForUser> =
    sheetData?.row_settings ?? {};

  return (
    <>
      {/* ── Top: task fields ─────────────────────────────────────────────── */}
      <Text
        style={{
          fontSize: 11,
          color: COLORS.textSecondary,
          fontWeight: 600,
          display: 'block',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {t('me.board.drawer_your_task_fields')}
      </Text>
      <SelfBoardActiveTaskPanel
        task={task}
        shipment={shipment}
        onComplete={onComplete}
        sheetItem={sheetItem}
        rows={sheetRows}
        rowSettings={sheetRowSettings}
        isSheetLoading={isSheetLoading}
      />

      {/* ── Middle: other editable shipment fields ────────────────────────── */}
      <>
        <Divider style={{ margin: '16px 0 12px' }} />
        <Text
          style={{
            fontSize: 11,
            color: COLORS.textSecondary,
            fontWeight: 600,
            display: 'block',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {t('me.board.drawer_shipment_fields')}
        </Text>
        <SelfBoardShipmentFieldList
          shipmentId={task.shipment}
          sheetItem={sheetItem}
          rows={sheetRows}
          rowSettings={sheetRowSettings}
          excludeFields={task.target_fields_list}
          isLoading={isSheetLoading}
        />
      </>

      {/* ── Bottom: read-only context + escape hatch ─────────────────────── */}
      <OtherShipmentDetails task={task} shipment={shipment} />
      <DrawerOpenInFullPageLink onOpen={onOpenShipment} />
    </>
  );
}
