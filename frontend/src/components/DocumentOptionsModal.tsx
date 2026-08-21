import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Form, Input, Modal, Select } from 'antd';

import { DocumentLayoutPopover } from '@/components/DocumentLayoutPopover';
import { useLoadingLocations } from '@/hooks/useAdmin';

export interface IDocumentOptions {
  readonly placeLoading?: string;
  readonly tirCarnet?: string;
  readonly highlight: boolean;
}

interface IDocumentOptionsModalProps {
  readonly open: boolean;
  readonly isGenerating: boolean;
  /** Show the loading-point picker (invoice, CMR and packet take one). */
  readonly withPlaceLoading?: boolean;
  /** Show the TIR carnet № field (CMR and packet only — Uzbekistan transit). */
  readonly withTirCarnet?: boolean;
  /**
   * Registry key of the document about to be generated. When set and tunable,
   * the page-layout gear appears in the title. Omitted for the CMR and the
   * packet: the CMR prints onto a pre-printed form, so its geometry is fixed.
   */
  readonly documentKey?: string;
  readonly onConfirm: (options: IDocumentOptions) => void;
  readonly onCancel: () => void;
}

// Keys whose geometry registers onto a pre-printed official form — the backend
// refuses layout adjustments for these, so no gear is offered.
const LAYOUT_LOCKED_KEYS = new Set(['cmr_ru', 'cmr_en', 'cmr_ru_docx', 'cmr_en_docx']);

/**
 * Write the shared generate-time options onto a document request's query string.
 *
 * Red highlighting is the server's default, so only the opt-out travels — that
 * keeps every existing URL in the app rendering exactly as before.
 */
export function applyDocumentOptions(
  params: URLSearchParams, options: IDocumentOptions,
): void {
  if (options.placeLoading) params.set('place_loading', options.placeLoading);
  if (options.tirCarnet?.trim()) params.set('tir_carnet', options.tirCarnet.trim());
  if (!options.highlight) params.set('highlight', '0');
}

/**
 * The generate-time options every document download shares.
 *
 * Previously duplicated across the CMR, packet-zip and invoice buttons; extracted
 * so a new option lands once instead of three times.
 */
export function DocumentOptionsModal({
  open,
  isGenerating,
  withPlaceLoading = true,
  withTirCarnet = false,
  documentKey,
  onConfirm,
  onCancel,
}: IDocumentOptionsModalProps) {
  const { t } = useTranslation();
  const { data: loadingLocations = [] } = useLoadingLocations();

  const [placeLoading, setPlaceLoading] = useState<string | undefined>(undefined);
  const [tirCarnet, setTirCarnet] = useState('');
  const [highlight, setHighlight] = useState(true);

  // Reset on every open so one truck's loading point never leaks into the next.
  useEffect(() => {
    if (open) {
      setPlaceLoading(undefined);
      setTirCarnet('');
      setHighlight(true);
    }
  }, [open]);

  const canTuneLayout = Boolean(documentKey) && !LAYOUT_LOCKED_KEYS.has(documentKey!);

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('documents.options_title')}
          {canTuneLayout && <DocumentLayoutPopover documentKey={documentKey!} />}
        </span>
      }
      onOk={() => onConfirm({ placeLoading, tirCarnet, highlight })}
      onCancel={onCancel}
      okText={t('documents.download')}
      confirmLoading={isGenerating}
      maskClosable={!isGenerating}
      cancelButtonProps={{ disabled: isGenerating }}
      closable={!isGenerating}
      destroyOnClose
    >
      <Form layout="vertical">
        {withPlaceLoading && (
          <Form.Item label={t('documents.place_loading')}>
            <Select
              value={placeLoading}
              onChange={setPlaceLoading}
              options={loadingLocations.map((loc) => ({ value: loc.name, label: loc.name }))}
              placeholder={t('documents.place_loading_ph')}
              allowClear
              showSearch
            />
          </Form.Item>
        )}
        {withTirCarnet && (
          <Form.Item label={t('documents.tir_carnet')}>
            <Input
              value={tirCarnet}
              onChange={(e) => setTirCarnet(e.target.value)}
              placeholder={t('documents.tir_carnet_ph')}
              allowClear
            />
          </Form.Item>
        )}
        <Form.Item extra={t('documents.highlight_extra')}>
          <Checkbox checked={highlight} onChange={(e) => setHighlight(e.target.checked)}>
            {t('documents.highlight')}
          </Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
