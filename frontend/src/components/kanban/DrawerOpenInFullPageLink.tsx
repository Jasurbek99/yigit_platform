import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

interface IDrawerOpenInFullPageLinkProps {
  onOpen: () => void;
}

/**
 * Small de-emphasized link rendered at the bottom of the drawer.
 * `type="text"` so the inline textSecondary colour wins — `type="link"` would
 * force AntD's brand blue, defeating the "de-emphasized escape hatch" intent.
 */
export function DrawerOpenInFullPageLink({
  onOpen,
}: IDrawerOpenInFullPageLinkProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: 24, textAlign: 'right' }}>
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
