import { Button, Input, Switch, Typography } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DeadlineTimer } from '@/components/DeadlineTimer';
import { useSheetStore } from '@/stores/sheetStore';
import { useSheetCreate } from '@/hooks/useSheetCreate';
import { useAuth } from '@/hooks/useAuth';

const { Text } = Typography;

const CREATE_ROLES = new Set(['export_manager', 'director']);

interface ISheetToolbarProps {
  shipmentCount: number;
}

export function SheetToolbar({ shipmentCount }: ISheetToolbarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { searchText, setSearchText, showGapyOnly, setShowGapyOnly } = useSheetStore();
  const createMutation = useSheetCreate();

  const canCreate = CREATE_ROLES.has(user?.role ?? '');

  return (
    <div className="sheet-toolbar">
      <div className="sheet-toolbar__left">
        {canCreate && (
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t('sheet.add_column')}
          </Button>
        )}
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('sheet.search_ph')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          size="small"
          style={{ width: 200 }}
        />
        <div className="sheet-toolbar__toggle">
          <Switch
            size="small"
            checked={showGapyOnly}
            onChange={setShowGapyOnly}
          />
          <Text style={{ fontSize: 12 }}>{t('sheet.gapy_only')}</Text>
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('sheet.total_count', { count: shipmentCount })}
        </Text>
      </div>
      <div className="sheet-toolbar__right">
        <DeadlineTimer compact />
      </div>
    </div>
  );
}
