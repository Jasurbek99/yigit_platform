import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Result
        status="403"
        title="403"
        subTitle={t('login.unauthorized_message')}
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            {t('login.back_home')}
          </Button>
        }
      />
    </div>
  );
}
