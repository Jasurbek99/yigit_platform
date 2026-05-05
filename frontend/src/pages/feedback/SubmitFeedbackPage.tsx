import { Collapse, Typography, Row, Col, Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';

const { Title, Paragraph, Text } = Typography;

function InstructionsPanel(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div>
      <Title level={5} style={{ marginTop: 0 }}>
        {t('feedback.instructions.title')}
      </Title>
      <Paragraph style={{ fontSize: 13 }}>
        {t('feedback.instructions.intro')}
      </Paragraph>
      <Title level={5} style={{ fontSize: 13 }}>
        {t('feedback.instructions.screenshot_title')}
      </Title>
      <Paragraph style={{ fontSize: 13 }}>
        <Text strong>{t('feedback.instructions.windows_label')}: </Text>
        {t('feedback.instructions.screenshot_windows')}
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        <Text strong>{t('feedback.instructions.mac_label')}: </Text>
        {t('feedback.instructions.screenshot_mac')}
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        <Text strong>{t('feedback.instructions.phone_label')}: </Text>
        {t('feedback.instructions.screenshot_phone')}
      </Paragraph>
      <Paragraph style={{ fontSize: 13 }}>
        {t('feedback.instructions.paste_hint')}
      </Paragraph>
    </div>
  );
}

export default function SubmitFeedbackPage(): React.ReactElement {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 4 }}>
        {t('feedback.submit.title')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24, fontSize: 13 }}>
        {t('feedback.submit.subtitle')}
      </Text>

      <Row gutter={24}>
        {/* Left — form */}
        <Col xs={24} md={14}>
          <Card>
            <FeedbackForm
              fromPath={location.pathname}
              navigateOnSuccess
            />
          </Card>
        </Col>

        {/* Right — instructions (desktop) / collapsed accordion (mobile) */}
        <Col xs={24} md={10}>
          {/* Desktop: always visible */}
          <div className="hide-on-mobile">
            <Card>
              <InstructionsPanel />
            </Card>
          </div>

          {/* Mobile: collapsible */}
          <div className="hide-on-desktop">
            <Collapse
              size="small"
              items={[
                {
                  key: 'instructions',
                  label: t('feedback.instructions.title'),
                  children: <InstructionsPanel />,
                },
              ]}
            />
          </div>
        </Col>
      </Row>

      <style>{`
        @media (min-width: 768px) { .hide-on-mobile { display: block; } .hide-on-desktop { display: none; } }
        @media (max-width: 767px) { .hide-on-mobile { display: none; } .hide-on-desktop { display: block; } }
      `}</style>
    </div>
  );
}
