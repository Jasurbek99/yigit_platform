import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';

interface IQuotaPageLinkProps {
  style?: React.CSSProperties;
}

/**
 * "Open quota page →" — offered inside a firm picker when some firm in it is
 * blocked for want of quota, which is only fixable on that page.
 *
 * An anchor with target="_blank", never an in-app navigate(): a same-tab route
 * change unmounts the picker and drops the selection in progress.
 *
 * Hidden from users who cannot open the page. `canSeePage('export.quota')`
 * also passes for a holder of the `export.quota.local_sell` child page — the
 * same OR logic the route itself uses (App.tsx `export/quota`).
 */
export function QuotaPageLink({ style }: IQuotaPageLinkProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!canSeePage(user, 'export.quota')) return null;

  return (
    <Button
      size="small"
      type="link"
      style={{ padding: 0, ...style }}
      href="/export/quota"
      target="_blank"
      rel="noopener noreferrer"
    >
      {t('sheet.firm_no_quota_link')}
    </Button>
  );
}
