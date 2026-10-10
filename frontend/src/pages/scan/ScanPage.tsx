import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Modal, Result, Space, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipmentScan, useRecordShipmentScan } from '@/hooks/useShipmentScan';
import { useAuth } from '@/hooks/useAuth';
import { EXTERNAL_ROLES } from '@/constants/roles';

const { Title, Text } = Typography;

/**
 * The page a pallet QR opens on a phone.
 *
 * Deliberately outside AppLayout: no sidebar, no nav — a driver holding a phone
 * in a yard needs the truck code, what is being recorded, and one button.
 *
 * It never records on load. The owner's rule is that a scan must ASK before it
 * moves the status, because a status step is a real-world event (2-3 hours
 * apart) and a mis-tap would otherwise advance the truck silently.
 */
export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  // An agent's seller scans the same pallet QR: his claim lives in the market app,
  // and the export scan API is not his — never call it for him.
  const { user } = useAuth();
  const external = Boolean(user && EXTERNAL_ROLES.includes(user.role));
  const { data, isLoading, isError, error } = useShipmentScan(user && !external ? id : undefined);
  const record = useRecordShipmentScan(id);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (external && id) window.location.replace(`/m/scan/${id}`);
  }, [external, id]);

  function fieldLabel(field: string): string {
    // Reuse the Sheet's own labels — all seven scan fields are already
    // translated there in en/ru/tk, so this page adds no parallel wording that
    // could drift from what the same event is called on the Sheet.
    return t(`shipment_edit_drawer.field.${field}`, { defaultValue: field });
  }

  if (isLoading || !user || external) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || !data) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return (
      <Result
        status={status === 403 || status === 404 ? '403' : 'error'}
        title={t('scan.error_title')}
        subTitle={
          status === 403
            ? t('scan.error_forbidden')
            : status === 404
              ? t('scan.error_not_found')
              : t('scan.error_generic')
        }
      />
    );
  }

  const already = data.already;
  const nothingToRecord = !data.field;

  function handleConfirm() {
    if (!data?.field) return;
    const field = data.field;
    record.mutate(field, {
      onSuccess: (res) => {
        setConfirming(false);
        if (res.recorded) {
          toast.success(t('scan.toast_recorded', { step: fieldLabel(field) }));
        } else {
          toast.info(t('scan.toast_already'));
        }
      },
      onError: (err: unknown) => {
        setConfirming(false);
        const status = (err as { response?: { status?: number } })?.response?.status;
        const detail = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        toast.error(
          status === 403 ? t('scan.toast_forbidden') : detail || t('scan.toast_failed'),
        );
      },
    });
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">{t('scan.truck_label')}</Text>
            <Title level={3} style={{ margin: '4px 0 0' }}>
              {data.export_code || data.code}
            </Title>
            {data.export_code && data.export_code !== data.code && (
              <Text type="secondary">{data.code}</Text>
            )}
          </div>

          <div>
            <Text type="secondary">{t('scan.status_label')}</Text>
            <div style={{ marginTop: 4 }}>
              <Tag color="blue" style={{ fontSize: 15, padding: '4px 10px' }}>
                {data.status
                  ? t(`shipment_status.${data.status}`, { defaultValue: data.status })
                  : '—'}
              </Tag>
            </div>
          </div>

          {already && (
            <Alert
              type="success"
              showIcon
              message={t('scan.already_title', { step: fieldLabel(already.field) })}
              description={
                <>
                  {already.recorded_by && (
                    <div>{t('scan.already_by', { name: already.recorded_by })}</div>
                  )}
                  {already.occurred_at && (
                    <div>
                      {t('scan.already_at', {
                        when: dayjs(already.occurred_at)
                          .locale(i18n.language)
                          .format('DD.MM.YYYY HH:mm'),
                      })}
                    </div>
                  )}
                </>
              }
            />
          )}

          {nothingToRecord && !already && (
            <Alert type="info" showIcon message={t('scan.nothing_to_record')} />
          )}

          {data.field && (
            <Button
              type="primary"
              size="large"
              block
              style={{ height: 56, fontSize: 17 }}
              onClick={() => setConfirming(true)}
              loading={record.isPending}
            >
              {t('scan.record_button', { step: fieldLabel(data.field) })}
            </Button>
          )}
        </Space>
      </Card>

      <Modal
        open={confirming}
        title={t('scan.confirm_title')}
        onOk={handleConfirm}
        onCancel={() => setConfirming(false)}
        okText={t('scan.confirm_ok')}
        cancelText={t('common.cancel')}
        confirmLoading={record.isPending}
        okButtonProps={{ size: 'large' }}
        cancelButtonProps={{ size: 'large' }}
      >
        <Space direction="vertical">
          <Text strong style={{ fontSize: 16 }}>
            {data.field ? fieldLabel(data.field) : ''}
          </Text>
          <Text>
            {t('scan.confirm_body', {
              truck: data.export_code || data.code,
            })}
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
