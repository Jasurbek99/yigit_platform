import { useEffect, useState } from 'react';
import { Button, Divider, Select, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import { PINNED_FIELD_KEYS } from '@/components/sheet/sheetRoleBlocks';
import { SheetRowStyleControls } from '@/components/sheet/SheetRowStyleControls';
import { COLORS } from '@/constants/styles';
import { SheetRowDetailHeader } from './SheetRowDetailHeader';
import { LocalizedFieldGroup } from './LocalizedFieldGroup';
import { SheetRowAccessSection } from './SheetRowAccessSection';
import { buildDraft, isDirty, type ISheetRowDraft } from './rowDraft';
import { useSaveRowDraft } from './useSaveRowDraft';

interface ISheetRowDetailProps {
  record: ISheetRowSetting;
  position: number;
  canWrite: boolean;
  roleOptions: Array<{ value: string; label: string }>;
  onDirtyChange: (dirty: boolean) => void;
  onDeleteCustom: (record: ISheetRowSetting) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Divider titlePlacement="start" style={{ margin: '20px 0 12px' }}>
      <span style={{ fontSize: 13, color: COLORS.textSecondary }}>{children}</span>
    </Divider>
  );
}

/** Everything configurable about one sheet row, saved as a single PATCH. */
export default function SheetRowDetail({
  record,
  position,
  canWrite,
  roleOptions,
  onDirtyChange,
  onDeleteCustom,
}: ISheetRowDetailProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ISheetRowDraft>(() => buildDraft(record));
  const { save, isPending } = useSaveRowDraft();

  // Re-seed on row switch and after a successful save (version bump → refetch).
  useEffect(() => {
    setDraft(buildDraft(record));
  }, [record.id, record.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isDirty(record, draft);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const patchDraft = (patch: Partial<ISheetRowDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  const disabled = !canWrite;
  const pinned = PINNED_FIELD_KEYS.has(record.field_key);

  // The three localized field trios, in panel order.
  const sections = [
    { prefix: 'label', titleKey: 'sheet_rows.section_labels', dottedKey: record.default_label_key, multiline: false },
    { prefix: 'who', titleKey: 'sheet_rows.section_who', dottedKey: record.default_who_key, multiline: false },
    { prefix: 'description', titleKey: 'sheet_rows.section_tooltip', dottedKey: null, multiline: true },
  ] as const;

  const roleGroupSelect = (
    <Select
      allowClear
      value={draft.role_group || undefined}
      options={roleOptions}
      disabled={disabled || pinned}
      onChange={(val?: string) => patchDraft({ role_group: val ?? '' })}
      style={{ width: '100%' }}
      placeholder={t('sheet_rows.role_group_none')}
      showSearch
      optionFilterProp="label"
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8 }}>
        <SheetRowDetailHeader
          record={record}
          position={position}
          isVisible={draft.is_visible}
          disabled={disabled}
          onVisibleChange={(val) => patchDraft({ is_visible: val })}
          onDeleteCustom={onDeleteCustom}
        />

        {sections.map((section) => (
          <div key={section.prefix}>
            <SectionTitle>{t(section.titleKey)}</SectionTitle>
            <LocalizedFieldGroup
              values={draft as unknown as Record<string, string>}
              fieldPrefix={section.prefix}
              dottedKey={section.dottedKey}
              multiline={section.multiline}
              disabled={disabled}
              onChange={(field, next) => patchDraft({ [field]: next } as Partial<ISheetRowDraft>)}
            />
          </div>
        ))}

        <SectionTitle>{t('sheet_rows.section_access')}</SectionTitle>
        <SheetRowAccessSection triggeredRoles={record.triggered_roles} />

        <SectionTitle>{t('sheet_rows.section_display')}</SectionTitle>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
          {t('sheet_rows.col_role_group')}
        </div>
        {pinned ? (
          <Tooltip title={t('sheet_rows.role_group_pinned_hint')}>{roleGroupSelect}</Tooltip>
        ) : (
          roleGroupSelect
        )}
        <div style={{ marginTop: 16 }}>
          <SheetRowStyleControls
            values={draft}
            canWrite={canWrite}
            onSave={(patch) => patchDraft(patch as Partial<ISheetRowDraft>)}
          />
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${COLORS.border}`,
          paddingTop: 12,
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Button
          type="primary"
          disabled={disabled || !dirty}
          loading={isPending}
          onClick={() => save(record, draft)}
        >
          {t('common.save')}
        </Button>
        <Button disabled={!dirty} onClick={() => setDraft(buildDraft(record))}>
          {t('sheet_rows.reset_changes')}
        </Button>
        {dirty && (
          <span style={{ fontSize: 12, color: COLORS.warning }}>
            {t('sheet_rows.unsaved_hint')}
          </span>
        )}
      </div>
    </div>
  );
}
