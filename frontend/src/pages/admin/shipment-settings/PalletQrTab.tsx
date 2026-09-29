import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useGreenhouseConfig, useUpdateGreenhouseConfig } from '@/hooks/useGreenhouseConfig';

const { Text, Paragraph } = Typography;

interface IPalletQrTabProps {
  canWrite: boolean;
}

/**
 * The base URL printed into pallet QR labels.
 *
 * It lives in the admin rather than only in the PLATFORM_URL env var because
 * the value is PRINTED: a label travels with the truck and cannot be
 * re-pointed once the host changes, so the owner must be able to set the final
 * address (a domain, once one is assigned) before a print run without waiting
 * for a deploy. Blank is valid and means "fall back to PLATFORM_URL, then the
 * requesting host" — which is why the field is never required.
 */
export default function PalletQrTab({ canWrite }: IPalletQrTabProps) {
  const { t } = useTranslation();
  const { data: config } = useGreenhouseConfig();
  const update = useUpdateGreenhouseConfig();
  const [value, setValue] = useState('');

  // Seed from the server once it arrives, and re-seed when it changes under us
  // (another admin saving) — but never while the user has unsaved edits.
  useEffect(() => {
    setValue(config?.scan_base_url ?? '');
  }, [config?.scan_base_url]);

  const saved = config?.scan_base_url ?? '';
  const dirty = value.trim().replace(/\/+$/, '') !== saved;

  function handleSave() {
    update.mutate(
      { scan_base_url: value.trim().replace(/\/+$/, '') },
      {
        onSuccess: () => toast.success(t('shipment_settings.pallet_qr.saved')),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: Record<string, string[]> } })
            ?.response?.data?.scan_base_url?.[0];
          toast.error(detail || t('shipment_settings.pallet_qr.save_failed'));
        },
      },
    );
  }

  // Shown so the owner can see exactly what a fresh label would encode before
  // committing a print run.
  const preview = (value.trim().replace(/\/+$/, '') || t('shipment_settings.pallet_qr.preview_fallback'));

  return (
    <Card>
      <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 640 }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('shipment_settings.pallet_qr.intro')}
        </Paragraph>

        <Alert
          type="warning"
          showIcon
          message={t('shipment_settings.pallet_qr.printed_warning')}
        />

        <Form layout="vertical" style={{ marginBottom: 0 }}>
          <Form.Item
            label={t('shipment_settings.pallet_qr.field_label')}
            extra={t('shipment_settings.pallet_qr.field_hint')}
            style={{ marginBottom: 12 }}
          >
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://ygt.example"
              disabled={!canWrite}
              allowClear
            />
          </Form.Item>

          <Form.Item label={t('shipment_settings.pallet_qr.preview_label')} style={{ marginBottom: 12 }}>
            <Text code>{preview}/scan/123</Text>
          </Form.Item>

          {canWrite && (
            <Button
              type="primary"
              onClick={handleSave}
              loading={update.isPending}
              disabled={!dirty}
            >
              {t('common.save')}
            </Button>
          )}
        </Form>
      </Space>
    </Card>
  );
}
