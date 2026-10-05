import { useTranslation } from 'react-i18next';
import { Checkbox, Flex, Input, Select, Typography } from 'antd';

import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { useLoadingLocations } from '@/hooks/useAdmin';

interface IShipmentDocsOptionsBarProps {
  readonly options: IDocumentOptions;
  readonly onChange: (patch: Partial<IDocumentOptions>) => void;
}

/**
 * The generate-time options the per-download modal used to ask every time,
 * set once for the whole card: loading point (invoice, ZIP), TIR carnet №
 * (CMR, ZIP — Uzbekistan transit only), CMR box 17 (optional) and the
 * red-highlight toggle.
 */
export function ShipmentDocsOptionsBar({ options, onChange }: IShipmentDocsOptionsBarProps) {
  const { t } = useTranslation();
  const { data: locations = [] } = useLoadingLocations();

  return (
    <Flex wrap="wrap" gap={12} align="center" style={{ marginTop: 8 }}>
      <Flex gap={6} align="center">
        <Typography.Text type="secondary">{t('documents.place_loading')}:</Typography.Text>
        <Select
          size="small"
          style={{ minWidth: 160 }}
          aria-label={t('documents.place_loading')}
          value={options.placeLoading || undefined}
          onChange={(value?: string) => onChange({ placeLoading: value ?? '' })}
          options={locations.map((loc) => ({ value: loc.name, label: loc.name }))}
          placeholder={t('documents.place_loading_ph')}
          status={options.placeLoading ? undefined : 'warning'}
          allowClear
        />
      </Flex>
      <Flex gap={6} align="center" style={{ flex: '1 1 260px', maxWidth: 420 }}>
        <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{t('documents.tir_carnet')}</Typography.Text>
        <Input
          size="small"
          value={options.tirCarnet}
          onChange={(e) => onChange({ tirCarnet: e.target.value })}
          placeholder={t('documents.tir_carnet_ph')}
          title={t('documents.tir_carnet_ph')}
          allowClear
        />
      </Flex>
      <Flex gap={6} align="center" style={{ flex: '1 1 260px', maxWidth: 420 }}>
        <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{t('documents.successive_carrier')}</Typography.Text>
        <Input
          size="small"
          value={options.successiveCarrier}
          onChange={(e) => onChange({ successiveCarrier: e.target.value })}
          placeholder={t('documents.successive_carrier_ph')}
          title={t('documents.successive_carrier_ph')}
          allowClear
        />
      </Flex>
      <Checkbox checked={options.highlight} onChange={(e) => onChange({ highlight: e.target.checked })}>
        {t('documents.highlight')}
      </Checkbox>
    </Flex>
  );
}
