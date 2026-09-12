import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Dropdown, Form, Input, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { IconBook } from '@tabler/icons-react';

import { useDocumentDownload } from '@/hooks/useDocumentDownload';

interface ITirCarnetButtonProps {
  readonly shipmentId: number;
  readonly disabled?: boolean;
  readonly size?: 'small' | 'middle' | 'large';
}

// The carnet is a print overlay onto the pre-printed booklet page, so the
// spreadsheet IS the document and is the default; PDF converts from it and is
// the slow path (LibreOffice). There is no Word variant — the source sheet has
// no borders of its own to derive a Word table from.
const FORMATS = [
  { fmt: 'xlsx', labelKey: 'excel' },
  { fmt: 'pdf', labelKey: 'pdf' },
] as const;

interface ITirOptions {
  readonly borderPoint: string;
  readonly cmrNumber: string;
  readonly driverPassport: string;
  readonly driver2Passport: string;
  readonly highlight: boolean;
}

const EMPTY: ITirOptions = {
  borderPoint: '',
  cmrNumber: '',
  driverPassport: '',
  driver2Passport: '',
  highlight: true,
};

/**
 * Truck-level TIR carnet download — one carnet per shipment, every export firm
 * named as holder. Hits GET /contracts/shipments/{id}/tir/.
 *
 * The haulier block's middle line is the border crossing, which the server reads
 * from the Sheet in Russian. The field here is only a fallback for the many
 * trucks whose Sheet column is still empty — filling the Sheet is the better fix.
 * The CMR number and the two driver passports have no home in the database at
 * all. Passports fall back to the fleet Driver record, but none is filled in
 * today, so what is typed here is what normally prints.
 *
 * The one- vs two-driver carnet variant is chosen by the server from the truck's
 * crew, so there is nothing to pick here.
 *
 * This keeps its own modal rather than extending DocumentOptionsModal: none of
 * that modal's fields (loading point, TIR carnet №) appear on the carnet, and
 * none of these four appear on the CMR or the invoice.
 */
export function TirCarnetButton({
  shipmentId,
  disabled = false,
  size = 'small',
}: ITirCarnetButtonProps) {
  const { t } = useTranslation();
  const { isGenerating, download } = useDocumentDownload();

  const [pendingFmt, setPendingFmt] = useState<string | null>(null);
  const [options, setOptions] = useState<ITirOptions>(EMPTY);

  // Reset on every open so one truck's haulier never leaks into the next.
  useEffect(() => {
    if (pendingFmt !== null) setOptions(EMPTY);
  }, [pendingFmt]);

  const items: MenuProps['items'] = FORMATS.map(({ fmt, labelKey }) => ({
    key: fmt,
    label: t(`documents.${labelKey}`),
  }));

  const set = <K extends keyof ITirOptions>(key: K, value: ITirOptions[K]): void =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  const handleConfirm = async (): Promise<void> => {
    if (pendingFmt === null) return;
    const params = new URLSearchParams({ fmt: pendingFmt });
    if (options.borderPoint.trim()) params.set('border_point', options.borderPoint.trim());
    if (options.cmrNumber.trim()) params.set('cmr_number', options.cmrNumber.trim());
    if (options.driverPassport.trim()) {
      params.set('driver_passport', options.driverPassport.trim());
    }
    if (options.driver2Passport.trim()) {
      params.set('driver_2_passport', options.driver2Passport.trim());
    }
    // Red highlighting is the server's default, so only the opt-out travels.
    if (!options.highlight) params.set('highlight', '0');

    const ok = await download(
      `/contracts/shipments/${shipmentId}/tir/?${params.toString()}`,
    );
    if (ok) setPendingFmt(null);
  };

  return (
    <>
      <Dropdown
        menu={{ items, onClick: ({ key }) => setPendingFmt(key) }}
        trigger={['click']}
        disabled={disabled}
      >
        <Button size={size} icon={<IconBook size={16} />} disabled={disabled}>
          {t('documents.tir')}
        </Button>
      </Dropdown>

      <Modal
        open={pendingFmt !== null}
        title={t('documents.tir_options_title')}
        onOk={handleConfirm}
        onCancel={() => setPendingFmt(null)}
        okText={t('documents.download')}
        confirmLoading={isGenerating}
        maskClosable={!isGenerating}
        cancelButtonProps={{ disabled: isGenerating }}
        closable={!isGenerating}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label={t('documents.tir_border_point')}
            extra={t('documents.tir_border_point_extra')}
            htmlFor="tir-border-point"
          >
            <Input
              id="tir-border-point"
              value={options.borderPoint}
              onChange={(e) => set('borderPoint', e.target.value)}
              placeholder={t('documents.tir_border_point_ph')}
              allowClear
            />
          </Form.Item>
          <Form.Item label={t('documents.tir_cmr_number')} htmlFor="tir-cmr-number">
            <Input
              id="tir-cmr-number"
              value={options.cmrNumber}
              onChange={(e) => set('cmrNumber', e.target.value)}
              placeholder={t('documents.tir_cmr_number_ph')}
              allowClear
            />
          </Form.Item>
          <Form.Item
            label={t('documents.tir_driver_passport')}
            extra={t('documents.tir_passport_extra')}
            htmlFor="tir-driver-passport"
          >
            <Input
              id="tir-driver-passport"
              value={options.driverPassport}
              onChange={(e) => set('driverPassport', e.target.value)}
              allowClear
            />
          </Form.Item>
          <Form.Item label={t('documents.tir_driver_2_passport')} htmlFor="tir-driver-2-passport">
            <Input
              id="tir-driver-2-passport"
              value={options.driver2Passport}
              onChange={(e) => set('driver2Passport', e.target.value)}
              allowClear
            />
          </Form.Item>
          <Form.Item extra={t('documents.highlight_extra')}>
            <Checkbox
              checked={options.highlight}
              onChange={(e) => set('highlight', e.target.checked)}
            >
              {t('documents.highlight')}
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
