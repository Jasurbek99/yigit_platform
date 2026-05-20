import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { MyTaskCard } from '@/components/shipment/MyTaskCard';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IEditFieldConfig, IEditFieldGroup } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail, ITaskListItem, ShipmentPhase } from '@/types';
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
};

interface ISelfBoardTaskDrawerProps {
  task: ITaskListItem | null;
  onClose: () => void;
}

export function SelfBoardTaskDrawer({ task, onClose }: ISelfBoardTaskDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: shipment, isLoading, isError } = useShipmentDetail(task?.shipment);

  const isActiveState =
    task != null &&
    (task.state === 'open' || task.state === 'in_progress' || task.state === 'blocked');
  const isActiveCard = isActiveState && shipment?.my_task?.id === task.id;

  function handleOpenShipment() {
    if (task == null) return;
    navigate(`/shipments/${task.shipment}`);
  }

  return (
    <Drawer
      open={task != null}
      onClose={onClose}
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
      {task == null ? null : isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : isError || !shipment ? (
        <Alert type="error" message={t('common.error')} />
      ) : isActiveCard ? (
        <>
          <MyTaskCard shipment={shipment} />
          <OtherShipmentDetails task={task} shipment={shipment} />
          <DrawerOpenInFullPageLink onOpen={handleOpenShipment} />
        </>
      ) : (
        <>
          <ReadOnlyTaskSummary task={task} />
          <DrawerOpenInFullPageLink onOpen={handleOpenShipment} />
        </>
      )}
    </Drawer>
  );
}

// ─── Other shipment details (read-only context) ──────────────────────────────

interface IOtherShipmentDetailsProps {
  task: ITaskListItem;
  shipment: IShipmentDetail;
}

function OtherShipmentDetails({ task, shipment }: IOtherShipmentDetailsProps) {
  const { t } = useTranslation();

  const taskFieldSet = new Set(task.target_fields_list);

  // Build the list of group sections, dropping fields that overlap the task,
  // have a null/empty value, and dropping whole groups that end up empty.
  const groupSections = EDIT_FIELD_GROUPS.map((group) => {
    const items = group.fields
      .filter((field) => !taskFieldSet.has(field.key))
      .map((field) => {
        const value = formatShipmentFieldValue(field, shipment, t);
        return value == null ? null : { field, value };
      })
      .filter((x): x is { field: IEditFieldConfig; value: string } => x != null);
    return items.length > 0 ? { group, items } : null;
  }).filter((x): x is { group: IEditFieldGroup; items: { field: IEditFieldConfig; value: string }[] } => x != null);

  if (groupSections.length === 0) {
    return null;
  }

  return (
    <>
      <Divider style={{ margin: '8px 0 12px' }} />
      <Collapse
        size="small"
        items={[
          {
            key: 'other-details',
            label: t('me.board.drawer_more_details'),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {groupSections.map(({ group, items }) => (
                  <Descriptions
                    key={group.key}
                    column={1}
                    size="small"
                    title={
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>
                        {t(group.titleKey)}
                      </Text>
                    }
                    labelStyle={{ width: 140, color: COLORS.textSecondary }}
                  >
                    {items.map(({ field, value }) => (
                      <Descriptions.Item key={field.key} label={t(field.labelKey)}>
                        {value}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}

/**
 * Read-only display value for a shipment field. Returns null when the field
 * is null / empty so the caller can drop the row.
 *
 * For FK selects we use the `_name` / `_display` partner already on
 * `IShipmentDetail` (no extra API call). For numbers we apply the same
 * suffix the editor would have shown. For unhandled cases we fall back to
 * the raw string value.
 */
function formatShipmentFieldValue(
  field: IEditFieldConfig,
  shipment: IShipmentDetail,
  t: TFunction,
): string | null {
  const record = shipment as unknown as Record<string, unknown>;
  const raw = record[field.key];
  if (raw === null || raw === undefined || raw === '') return null;

  // FK selects and the transportUsers option_select all have a `_name` /
  // `_display` partner on the detail payload.
  const NAME_PARTNER: Record<string, string> = {
    country: 'country_name',
    customer: 'customer_name',
    city: 'city_name',
    import_firm: 'import_firm_name',
    border_point: 'border_point_name',
    variety: 'variety_name',
    vehicle_responsible: 'vehicle_responsible_display',
  };
  const partnerKey = NAME_PARTNER[field.key];
  if (partnerKey) {
    const partner = record[partnerKey];
    if (typeof partner === 'string' && partner.trim()) return partner;
    return null;
  }

  if (field.inputType === 'boolean') {
    return raw ? t('common.yes') : t('common.no');
  }

  if (field.inputType === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) return null;
    const formatted = n.toLocaleString();
    return field.suffix ? `${formatted} ${field.suffix}` : formatted;
  }

  if (field.inputType === 'date') {
    return dayjs(raw as string).format('DD MMM YYYY');
  }

  if (field.inputType === 'datetime') {
    return dayjs(raw as string).format('DD MMM YYYY HH:mm');
  }

  // Weekday select — translate the 'mon' / 'tue' / ... code via existing
  // weekday.* keys instead of leaking the raw code into the UI.
  if (field.optionsSource === 'weekdays') {
    return t(`weekday.${String(raw)}`);
  }

  // text, textarea, plain option_select (raw enum string like 'OK')
  // — option_select values are the same raw codes shown elsewhere in
  // the app (e.g. SheetCell.tsx renders vehicle_condition the same way).
  return String(raw);
}

// ─── Footer link ─────────────────────────────────────────────────────────────

interface IDrawerOpenInFullPageLinkProps {
  onOpen: () => void;
}

/**
 * Small de-emphasized link rendered at the bottom of the drawer. Most users
 * complete the task inline; this is the escape hatch for inspecting the
 * full Shipment Detail (status log, comments, route timeline) that the
 * drawer doesn't surface.
 */
function DrawerOpenInFullPageLink({ onOpen }: IDrawerOpenInFullPageLinkProps) {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: 24, textAlign: 'right' }}>
      {/* type="text" so the inline `color: textSecondary` actually wins —
          type="link" would force AntD's brand blue and override the inline
          style, defeating the "de-emphasized escape hatch" intent. */}
      <Button
        type="text"
        size="small"
        onClick={onOpen}
        style={{ fontSize: 12, color: COLORS.textSecondary, padding: 0, height: 'auto' }}
      >
        {t('me.board.drawer_open_shipment')}
      </Button>
    </div>
  );
}

// ─── Read-only task summary (done / cancelled) ───────────────────────────────

interface IReadOnlyTaskSummaryProps {
  task: ITaskListItem;
}

function ReadOnlyTaskSummary({ task }: IReadOnlyTaskSummaryProps) {
  const { t } = useTranslation();

  const completedDisplay = task.completed_at
    ? dayjs(task.completed_at).format('DD MMM YYYY HH:mm')
    : null;
  const deadlineDisplay = task.deadline
    ? dayjs(task.deadline).format('DD MMM YYYY HH:mm')
    : null;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
        {task.shipment_cargo_code}
      </div>

      <Tag color={task.state === 'done' ? 'success' : 'default'} style={{ margin: 0 }}>
        {t(`tasks.state.${task.state}`)}
      </Tag>

      {deadlineDisplay && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {deadlineDisplay}
        </Text>
      )}

      {completedDisplay && (
        <Text>
          {t('me.board.drawer_readonly_completed', { when: completedDisplay })}
        </Text>
      )}
    </Space>
  );
}
