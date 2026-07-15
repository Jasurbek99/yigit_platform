import { useMemo, useState } from 'react';
import { Alert, Button, Card, Flex, Skeleton, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  usePallets,
  useUpsertPallets,
  useCloseManifest,
  useImportWeightmaster,
} from '@/hooks/usePallets';
import { useCrateTypes } from '@/hooks/useAdmin';
import type { IPalletUpsertRow, IWeightmasterWarning } from '@/types';
import { ManifestStats } from './ManifestStats';
import { DistributionPills } from './DistributionPills';
import { VarietyRollupCard } from './VarietyRollupCard';
import { PalletTable } from './PalletTable';
import { BlockBreakdownCard } from './BlockBreakdownCard';
import {
  palletToEditableRow,
  weightmasterRowToEditableRow,
  type IEditableRow,
} from './palletHelpers';

const { Text } = Typography;

interface IPalletManifestPanelProps {
  /** Remount (key={shipmentId}) when switching trucks to reset local row state. */
  readonly shipmentId: number;
}

/**
 * The pallet-manifest editor body: weightmaster Excel upload, editable pallet
 * grid, save/close actions, variety roll-up, and block breakdown. Driven by
 * `shipmentId` so it can be embedded both on the per-shipment manifest route
 * and on the standalone Weightmaster page.
 */
export function PalletManifestPanel({ shipmentId }: IPalletManifestPanelProps) {
  const { t } = useTranslation();

  const { data: palletsRaw = [], isLoading: palletsLoading } = usePallets(shipmentId);
  const { data: crateTypes = [] } = useCrateTypes();

  const upsertMutation = useUpsertPallets(shipmentId);
  const closeMutation = useCloseManifest(shipmentId);
  const importMutation = useImportWeightmaster(shipmentId);

  const [warnings, setWarnings] = useState<IWeightmasterWarning[]>([]);
  const [rows, setRows] = useState<IEditableRow[]>([]);
  const [initialised, setInitialised] = useState(false);

  const filledByName = palletsRaw[0]?.created_by_name ?? null;

  const crateWeightMap = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const ct of crateTypes) map[ct.id] = parseFloat(ct.weight_kg);
    return map;
  }, [crateTypes]);

  if (!initialised && palletsRaw.length > 0) {
    setRows(palletsRaw.map(palletToEditableRow));
    setInitialised(true);
  }

  function handleAddPallet() {
    const nextNum = rows.length > 0 ? Math.max(...rows.map((r) => r.pallet_number)) + 1 : 1;
    const firstActiveCrate = crateTypes.find((ct) => ct.is_active);
    setRows((prev) => [...prev, {
      key: nextNum,
      pallet_number: nextNum,
      crate_type: firstActiveCrate?.id ?? 1,
      crate_type_name: firstActiveCrate?.name ?? '',
      crate_count: 64,
      gross_weight_kg: 0,
      pallet_weight_kg: 7,
      additions_kg: 4,
      variety: 0,
      variety_name: '',
      sub_block: 0,
      sub_block_code: '',
    }]);
  }

  function handleChangeRow(key: number, field: keyof IEditableRow, value: unknown) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function handleSave() {
    const payload: IPalletUpsertRow[] = rows.map((r) => ({
      pallet_number: r.pallet_number,
      crate_type: r.crate_type,
      crate_count: r.crate_count,
      gross_weight_kg: r.gross_weight_kg,
      pallet_weight_kg: r.pallet_weight_kg,
      additions_kg: r.additions_kg,
      variety: r.variety,
      sub_block: r.sub_block,
      loaded_at: r.loaded_at,
    }));
    upsertMutation.mutate(payload, {
      onSuccess: () => toast.success(t('pallet.toast_saved')),
    });
  }

  function handleWeightmasterUpload(file: File) {
    importMutation.mutate(file, {
      onSuccess: (preview) => {
        setRows(preview.rows.map(weightmasterRowToEditableRow));
        setInitialised(true);
        setWarnings(preview.warnings);
        if (preview.summary.code_mismatch) {
          toast.warning(t('pallet.import_code_mismatch', { code: preview.summary.load_code }));
        }
        if (preview.warnings.length > 0) {
          toast.warning(t('pallet.import_warnings', { count: preview.warnings.length }));
        } else {
          toast.success(t('pallet.import_ok', { count: preview.summary.pallet_count }));
        }
      },
      onError: () => toast.error(t('pallet.import_failed')),
    });
  }

  function handleCloseManifest() {
    closeMutation.mutate(undefined, {
      onSuccess: () => toast.success(t('pallet.toast_closed')),
    });
  }

  function handleLogoExport() {
    toast.info(t('pallet.toast_logo_todo'));
  }

  if (palletsLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <div>
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
        {filledByName && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('pallet.filled_by', { name: filledByName })}
          </Text>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Upload
            accept=".xlsx"
            showUploadList={false}
            beforeUpload={(file) => {
              handleWeightmasterUpload(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={importMutation.isPending}>
              {t('pallet.btn_import_weightmaster')}
            </Button>
          </Upload>
          <Button onClick={handleLogoExport}>{t('pallet.btn_logo_export')}</Button>
          <Button
            type="primary"
            loading={closeMutation.isPending}
            disabled={rows.length === 0}
            onClick={handleCloseManifest}
          >
            {t('pallet.btn_close_manifest')}
          </Button>
        </div>
      </Flex>

      <Alert type="info" showIcon message={t('pallet.banner_source_of_truth')} style={{ marginBottom: 16 }} />

      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setWarnings([])}
          message={t('pallet.import_warnings_title', { count: warnings.length })}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {warnings.map((w, i) => (
                <li key={i}>
                  {t('pallet.import_warning_row', { pallet: w.pallet_number ?? '—' })}: {w.message}
                </li>
              ))}
            </ul>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 14 }}>
        <div style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 12, marginBottom: 12 }}>
          <ManifestStats rows={rows} crateWeightMap={crateWeightMap} />
        </div>
        <DistributionPills rows={rows} crateWeightMap={crateWeightMap} />
      </Card>

      <Card
        title={<span>{t('pallet.stat_pallets')} ({rows.length})</span>}
        extra={
          <Flex gap={8}>
            <Button size="small" onClick={handleAddPallet}>{t('pallet.btn_add_pallet')}</Button>
            <Button size="small" type="primary" loading={upsertMutation.isPending} onClick={handleSave}>
              {t('pallet.btn_save')}
            </Button>
          </Flex>
        }
      >
        {rows.length === 0 ? (
          <Text type="secondary">{t('pallet.empty_state')}</Text>
        ) : (
          <PalletTable rows={rows} crateWeightMap={crateWeightMap} onChangeRow={handleChangeRow} />
        )}
      </Card>

      <VarietyRollupCard rows={rows} crateWeightMap={crateWeightMap} shipmentId={shipmentId} />
      <BlockBreakdownCard shipmentId={shipmentId} />
    </div>
  );
}
