import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Collapse, Modal, Space, Typography } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import api from '@/services/api';
import { useSwapShipments } from '@/hooks/useDrafts';
import { useSheetStore } from '@/stores/sheetStore';
import { buildGroupedFields, SWAPPABLE_FIELD_KEYS } from './swapFieldGroups';
import { FONT } from '@/constants/styles';
import type { IShipmentSheetItem } from '@/types';

const { Text, Title } = Typography;

// ─── Props ─────────────────────────────────────────────────────────────────

interface ISwapFieldsModalProps {
  open: boolean;
  onClose: () => void;
  shipmentA: IShipmentSheetItem;
  shipmentB: IShipmentSheetItem;
}

// ─── Value renderer ────────────────────────────────────────────────────────

/**
 * Resolves a human-readable display value for a field on a shipment.
 * Prefers the companion _name / _display field for FKs.
 * Formats datetimes via dayjs. Renders booleans as Yes/No.
 * Falls back to dim "—" for null/empty.
 */
function renderFieldValue(
  fieldKey: string,
  shipment: IShipmentSheetItem,
  inputType: string,
  t: (key: string) => string,
): React.ReactNode {
  // FK companion fields — order matters: check compound names first
  const fkCompanions: Record<string, string> = {
    country: 'country_name',
    customer: 'customer_name',
    city: 'city_name',
    import_firm: 'import_firm_name',
    border_point: 'border_point_name',
    variety: 'variety_name',
    vehicle_responsible: 'vehicle_responsible_display',
  };

  const raw = (shipment as unknown as Record<string, unknown>)[fieldKey];

  // FK: use companion _name if it exists
  if (fieldKey in fkCompanions) {
    const companionKey = fkCompanions[fieldKey];
    const companion = (shipment as unknown as Record<string, unknown>)[companionKey];
    if (companion != null && companion !== '') {
      return <span>{String(companion)}</span>;
    }
    if (raw == null || raw === '') {
      return <Text type="secondary" style={{ fontStyle: 'italic' }}>—</Text>;
    }
    return <span>{String(raw)}</span>;
  }

  // Boolean
  if (typeof raw === 'boolean') {
    return (
      <Text style={{ color: raw ? '#16a34a' : '#6b7280' }}>
        {raw ? t('common.yes') : t('common.no')}
      </Text>
    );
  }

  // Null / empty
  if (raw == null || raw === '') {
    return <Text type="secondary" style={{ fontStyle: 'italic' }}>—</Text>;
  }

  // Datetime / date
  if (inputType === 'datetime' || inputType === 'date') {
    const parsed = dayjs(String(raw));
    if (!parsed.isValid()) {
      return <span>{String(raw)}</span>;
    }
    const fmt = inputType === 'date' ? 'DD.MM.YYYY' : 'DD.MM.YYYY HH:mm';
    return <span>{parsed.format(fmt)}</span>;
  }

  return <span>{String(raw)}</span>;
}

// ─── Group row component ────────────────────────────────────────────────────

interface IGroupRowProps {
  fieldKey: string;
  label: string;
  inputType: string;
  checked: boolean;
  shipmentA: IShipmentSheetItem;
  shipmentB: IShipmentSheetItem;
  onToggle: (fieldKey: string) => void;
  t: (key: string) => string;
}

function SwapGroupRow({
  fieldKey,
  label,
  inputType,
  checked,
  shipmentA,
  shipmentB,
  onToggle,
  t,
}: IGroupRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 1fr 20px 1fr',
        alignItems: 'center',
        gap: 8,
        padding: '5px 0',
        borderBottom: '1px solid #f0f0f0',
        fontSize: 12,
      }}
    >
      <Checkbox checked={checked} onChange={() => onToggle(fieldKey)} />
      <Text style={{ fontSize: 12, fontWeight: 500 }}>{label}</Text>
      <div style={{ minWidth: 0 }}>
        {renderFieldValue(fieldKey, shipmentA, inputType, t)}
      </div>
      <Text type="secondary" style={{ textAlign: 'center' }}>⇄</Text>
      <div style={{ minWidth: 0 }}>
        {renderFieldValue(fieldKey, shipmentB, inputType, t)}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function SwapFieldsModal({
  open,
  onClose,
  shipmentA,
  shipmentB,
}: ISwapFieldsModalProps) {
  const { t } = useTranslation();
  const setSwapMode = useSheetStore((s) => s.setSwapMode);
  const rows = useSheetStore((s) => s.rows);
  const swapMutation = useSwapShipments();

  // ─── Selected fields ────────────────────────────────────────────────────
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  // Build groups with resolved field keys
  const groups = useMemo(() => buildGroupedFields(), []);

  // Build a label lookup from the runtime row config (same source as the sheet)
  const labelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.field_key] = t(row.label_key);
    }
    return map;
  }, [rows, t]);

  // Build an inputType lookup
  const inputTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.field_key] = row.input_type;
    }
    return map;
  }, [rows]);

  // ─── Server whitelist sanity check ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    api
      .get<{ fields: string[] }>('/export/shipments/swappable-fields/')
      .then(({ data }) => {
        if (cancelled) return;
        const serverSet = new Set(data.fields);
        const onlyInClient: string[] = [];
        const onlyInServer: string[] = [];
        for (const fk of SWAPPABLE_FIELD_KEYS) {
          if (!serverSet.has(fk)) onlyInClient.push(fk);
        }
        for (const fk of serverSet) {
          if (!SWAPPABLE_FIELD_KEYS.has(fk)) onlyInServer.push(fk);
        }
        if (onlyInClient.length > 0 || onlyInServer.length > 0) {
          console.warn(
            '[SwapFieldsModal] Whitelist mismatch with server:',
            { onlyInClient, onlyInServer },
          );
        }
      })
      .catch(() => {
        // Network error or endpoint not yet deployed — safe to ignore silently.
        // The backend will gate what's actually swappable at mutation time.
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset selections when modal opens or the pair changes
  useEffect(() => {
    if (open) {
      setSelectedFields(new Set());
    }
  }, [open, shipmentA.id, shipmentB.id]);

  // ─── Selection helpers ──────────────────────────────────────────────────

  function toggleField(fieldKey: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  }

  function selectGroup(fieldKeys: string[]) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      for (const fk of fieldKeys) next.add(fk);
      return next;
    });
  }

  function deselectGroup(fieldKeys: string[]) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      for (const fk of fieldKeys) next.delete(fk);
      return next;
    });
  }

  function selectAll() {
    const all = new Set<string>();
    for (const g of groups) {
      for (const fk of g.fieldKeys) all.add(fk);
    }
    setSelectedFields(all);
  }

  function deselectAll() {
    setSelectedFields(new Set());
  }

  // ─── Confirm ────────────────────────────────────────────────────────────

  function handleConfirm() {
    const fields = [...selectedFields];
    if (fields.length === 0) return;

    swapMutation.mutate(
      { aId: shipmentA.id, otherId: shipmentB.id, fields },
      {
        onSuccess: () => {
          toast.success(
            t('sheet.swap_modal.toast_success', { count: fields.length }),
          );
          onClose();
          setSwapMode(false);
        },
        onError: (err) => {
          const data = (err as { response?: { data?: { error?: string } } }).response?.data;
          const msg = data?.error ?? (err as Error).message ?? '';
          toast.error(`${t('sheet.swap_modal.toast_error')}${msg ? `: ${msg}` : ''}`);
        },
      },
    );
  }

  // ─── Derived state ──────────────────────────────────────────────────────

  const selectedCount = selectedFields.size;

  const defaultActiveKeys = useMemo(
    () => groups.filter((g) => g.defaultExpanded).map((g) => g.id),
    [groups],
  );

  // ─── Collapse items ─────────────────────────────────────────────────────

  const collapseItems = useMemo(() => {
    return groups.map((group) => {
      const groupSelected = group.fieldKeys.filter((fk) => selectedFields.has(fk));
      const allGroupSelected = groupSelected.length === group.fieldKeys.length;
      const noneGroupSelected = groupSelected.length === 0;

      const label = t(group.titleKey);
      const headerLabel = `${label} (${group.fieldKeys.length})`;

      return {
        key: group.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>{headerLabel}</span>
            <Space size={4} onClick={(e) => e.stopPropagation()}>
              <Button
                type="link"
                size="small"
                style={{ fontSize: 11, padding: '0 4px', height: 'auto' }}
                onClick={() => {
                  if (allGroupSelected) {
                    deselectGroup(group.fieldKeys);
                  } else {
                    selectGroup(group.fieldKeys);
                  }
                }}
              >
                {allGroupSelected && !noneGroupSelected
                  ? t('sheet.swap_modal.deselect_all')
                  : noneGroupSelected || !allGroupSelected
                  ? t('sheet.swap_modal.select_all')
                  : t('sheet.swap_modal.deselect_all')}
              </Button>
            </Space>
          </div>
        ),
        children: (
          <div>
            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 1fr 20px 1fr',
                gap: 8,
                padding: '0 0 4px 0',
                borderBottom: '2px solid #e5e7eb',
                marginBottom: 2,
              }}
            >
              <div />
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
                {t('sheet.swap_modal.field_label')}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, fontFamily: FONT.mono }}>
                A: {shipmentA.cargo_code}
              </Text>
              <div />
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, fontFamily: FONT.mono }}>
                B: {shipmentB.cargo_code}
              </Text>
            </div>
            {group.fieldKeys.map((fieldKey) => (
              <SwapGroupRow
                key={fieldKey}
                fieldKey={fieldKey}
                label={labelMap[fieldKey] ?? fieldKey}
                inputType={inputTypeMap[fieldKey] ?? 'text'}
                checked={selectedFields.has(fieldKey)}
                shipmentA={shipmentA}
                shipmentB={shipmentB}
                onToggle={toggleField}
                t={t}
              />
            ))}
          </div>
        ),
      };
    });
  }, [groups, selectedFields, labelMap, inputTypeMap, shipmentA, shipmentB, t]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div>
          <Title level={5} style={{ margin: 0 }}>
            {t('sheet.swap_modal.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {t('sheet.swap_modal.subtitle')}
          </Text>
        </div>
      }
      width={760}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>{t('sheet.swap_modal.cancel')}</Button>
          <Button
            type="primary"
            icon={<SwapOutlined />}
            disabled={selectedCount === 0}
            loading={swapMutation.isPending}
            onClick={handleConfirm}
          >
            {t('sheet.swap_modal.confirm', { count: selectedCount })}
          </Button>
        </div>
      }
      destroyOnClose
    >
      {/* Top-level select/deselect all toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginBottom: 8,
          paddingBottom: 8,
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {selectedCount > 0
            ? t('sheet.swap_modal.n_selected', { count: selectedCount })
            : t('sheet.swap_modal.subtitle')}
        </Text>
        <Button type="link" size="small" style={{ fontSize: 12 }} onClick={selectAll}>
          {t('sheet.swap_modal.select_all')}
        </Button>
        <Button type="link" size="small" style={{ fontSize: 12 }} onClick={deselectAll}>
          {t('sheet.swap_modal.deselect_all')}
        </Button>
      </div>

      <Collapse
        items={collapseItems}
        defaultActiveKey={defaultActiveKeys}
        size="small"
        style={{ background: 'transparent' }}
      />
    </Modal>
  );
}
