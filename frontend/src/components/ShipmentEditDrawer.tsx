import { useEffect, useState } from 'react';
import { Drawer, Form, Button, Space, Divider, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { FieldEditor } from '@/components/FieldEditor';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import { useAuth } from '@/hooks/useAuth';
import { canEditField } from '@/utils/permissions';
import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IEditFieldGroup, IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

const { Title, Text } = Typography;

interface IShipmentEditDrawerProps {
  open: boolean;
  onClose: () => void;
  shipment: IShipmentDetail;
  /** Restrict the drawer to a single group key. Omit to show all groups. */
  groupKey?: IEditFieldGroup['key'];
  /** Override the drawer title. Defaults to a per-group i18n title. */
  title?: string;
}

type FieldValue = unknown;

/**
 * Reusable drawer for web-management edits on a single shipment.
 * Renders one section per group, only including fields the current user
 * can edit. Saves all changed fields in a single multi-field PATCH.
 */
export function ShipmentEditDrawer({
  open,
  onClose,
  shipment,
  groupKey,
  title,
}: IShipmentEditDrawerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const patch = useShipmentPatchMulti();

  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  // Reset form state when shipment or open state changes
  useEffect(() => {
    if (!open) return;
    const next: Record<string, FieldValue> = {};
    EDIT_FIELD_GROUPS.forEach((group) => {
      group.fields.forEach((field) => {
        next[field.key] = (shipment as unknown as Record<string, FieldValue>)[field.key] ?? null;
      });
    });
    setValues(next);
    setDirty(new Set());
  }, [open, shipment]);

  const groups: IEditFieldGroup[] = groupKey
    ? EDIT_FIELD_GROUPS.filter((g) => g.key === groupKey)
    : EDIT_FIELD_GROUPS;

  // Filter to fields the user can edit; drop groups that end up empty
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => canEditField(user, 'shipment', field.key)),
    }))
    .filter((group) => group.fields.length > 0);

  function handleChange(field: IEditFieldConfig, value: FieldValue) {
    setValues((prev) => {
      const next = { ...prev, [field.key]: value };
      // If country changes, clear city — city options depend on it
      if (field.key === 'country' && prev.country !== value) {
        next.city = null;
      }
      return next;
    });
    setDirty((prev) => {
      const next = new Set(prev);
      next.add(field.key);
      // City auto-clear should also be saved
      if (field.key === 'country') {
        next.add('city');
      }
      return next;
    });
  }

  function handleSave() {
    if (dirty.size === 0) {
      onClose();
      return;
    }
    const payload: Record<string, FieldValue> = {};
    dirty.forEach((key) => {
      payload[key] = values[key];
    });
    patch.mutate(
      { id: shipment.id, fields: payload },
      {
        onSuccess: () => {
          message.success(t('shipment_edit_drawer.save_success'));
          onClose();
        },
      },
    );
  }

  const drawerTitle =
    title ??
    (groupKey
      ? t(EDIT_FIELD_GROUPS.find((g) => g.key === groupKey)?.titleKey ?? 'shipment_edit_drawer.title')
      : t('shipment_edit_drawer.title'));

  const noEditableFields = visibleGroups.length === 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={drawerTitle}
      width={480}
      destroyOnHidden
      maskClosable={!patch.isPending}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={patch.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="primary"
            onClick={handleSave}
            loading={patch.isPending}
            disabled={dirty.size === 0 || noEditableFields}
          >
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 12, fontSize: 12, color: '#8c8c8c' }}>
        {shipment.cargo_code} — {shipment.customer_name ?? '—'}
      </div>

      {noEditableFields ? (
        <Text type="secondary">{t('shipment_edit_drawer.no_editable_fields')}</Text>
      ) : (
        <Form layout="vertical">
          {visibleGroups.map((group, idx) => (
            <div key={group.key}>
              {idx > 0 && <Divider style={{ margin: '8px 0 12px' }} />}
              {!groupKey && (
                <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                  {t(group.titleKey)}
                </Title>
              )}
              {group.fields.map((field) => (
                <Form.Item
                  key={field.key}
                  label={t(field.labelKey)}
                  style={{ marginBottom: 12 }}
                >
                  <FieldEditor
                    config={field}
                    value={values[field.key]}
                    onChange={(v) => handleChange(field, v)}
                    countryId={(values.country as number | null) ?? null}
                    disabled={patch.isPending}
                  />
                </Form.Item>
              ))}
            </div>
          ))}
        </Form>
      )}
    </Drawer>
  );
}
