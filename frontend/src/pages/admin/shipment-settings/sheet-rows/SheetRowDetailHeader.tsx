import { Button, Space, Switch, Tag } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { ISheetRowSetting } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

interface ISheetRowDetailHeaderProps {
  record: ISheetRowSetting;
  position: number;
  isVisible: boolean;
  disabled: boolean;
  onVisibleChange: (next: boolean) => void;
  onDeleteCustom: (record: ISheetRowSetting) => void;
}

/** Identity line of the detail panel: field_key, position, visibility, audit. */
export function SheetRowDetailHeader({
  record,
  position,
  isVisible,
  disabled,
  onVisibleChange,
  onDeleteCustom,
}: ISheetRowDetailHeaderProps) {
  const { t } = useTranslation();
  return (
    <>
      <Space size={8} wrap>
        <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{record.field_key}</span>
        <Tag>#{position}</Tag>
        {record.is_custom && <Tag color="purple">{t('sheet_rows.custom_badge')}</Tag>}
        <Switch
          size="small"
          checked={isVisible}
          disabled={disabled}
          onChange={onVisibleChange}
        />
        <span style={{ fontSize: 12 }}>{t('sheet_rows.visible_label')}</span>
        {record.is_custom && (
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={disabled}
            onClick={() => onDeleteCustom(record)}
          >
            {t('sheet_rows.custom_delete_tooltip')}
          </Button>
        )}
      </Space>
      <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 4 }}>
        {t('sheet_rows.col_updated')}: {record.updated_by_name ?? '—'}
        {record.updated_at ? ` · ${dayjs(record.updated_at).format('DD.MM.YYYY HH:mm')}` : ''}
      </div>
    </>
  );
}
