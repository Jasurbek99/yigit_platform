import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Flex,
  Skeleton,
  Typography,
  Upload,
} from 'antd';
import { ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import {
  usePallets,
  useUpsertPallets,
  useCloseManifest,
  useImportWeightmaster,
} from '@/hooks/usePallets';
import { useAuth } from '@/hooks/useAuth';
import { useCrateTypes } from '@/hooks/useAdmin';
import type { IPalletUpsertRow, IWeightmasterWarning } from '@/types';
import { ManifestStats } from './pallet/ManifestStats';
import { DistributionPills } from './pallet/DistributionPills';
import { VarietyRollupCard } from './pallet/VarietyRollupCard';
import { PalletTable } from './pallet/PalletTable';
import {
  palletToEditableRow,
  weightmasterRowToEditableRow,
  type IEditableRow,
} from './pallet/palletHelpers';
import { FONT } from '@/constants/styles';

const { Text, Title } = Typography;

export default function PalletManifest() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const shipmentId = id ? parseInt(id, 10) : null;

  const { data: shipment, isLoading: shipmentLoading } = useShipmentDetail(id);
  const { data: palletsRaw = [], isLoading: palletsLoading } = usePallets(shipmentId);
  const { data: crateTypes = [] } = useCrateTypes();
  useAuth(); // ensures auth guard is active

  const upsertMutation = useUpsertPallets(shipmentId!);
  const closeMutation = useCloseManifest(shipmentId!);
  const importMutation = useImportWeightmaster(shipmentId!);

  const [warnings, setWarnings] = useState<IWeightmasterWarning[]>([]);

  // Who last filled the manifest (created_by on the saved pallets).
  const filledByName = palletsRaw[0]?.created_by_name ?? null;

  const crateWeightMap = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const ct of crateTypes) {
      map[ct.id] = parseFloat(ct.weight_kg);
    }
    return map;
  }, [crateTypes]);

  const [rows, setRows] = useState<IEditableRow[]>([]);
  const [initialised, setInitialised] = useState(false);

  if (!initialised && palletsRaw.length > 0) {
    setRows(palletsRaw.map(palletToEditableRow));
    setInitialised(true);
  }

  function handleAddPallet() {
    const nextNum = rows.length > 0 ? Math.max(...rows.map((r) => r.pallet_number)) + 1 : 1;
    const firstActiveCrate = crateTypes.find((ct) => ct.is_active);
    const newRow: IEditableRow = {
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
    };
    setRows((prev) => [...prev, newRow]);
  }

  function handleChangeRow(key: number, field: keyof IEditableRow, value: unknown) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
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
    // TODO: Logo Tiger ERP export — deferred. See Kaka_Findings_v2.md §4 line 134.
    toast.info(t('pallet.toast_logo_todo'));
  }

  if (shipmentLoading || palletsLoading) {
    return <div style={{ padding: 24 }}><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }

  if (!shipment) {
    return <Alert type="error" message={t('pallet.title')} style={{ margin: 24 }} />;
  }

  return (
    <div style={{ padding: 24 }}>
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} aria-label={t('common.back')} />
        <Title level={4} style={{ margin: 0 }}>
          {t('pallet.title')} — <span style={{ fontFamily: FONT.mono }}>{shipment.shipment_code}</span>
        </Title>
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
              return false; // prevent antd's auto-upload; we POST manually
            }}
          >
            <Button icon={<UploadOutlined />} loading={importMutation.isPending}>
              {t('pallet.btn_import_weightmaster')}
            </Button>
          </Upload>
          <Button onClick={handleLogoExport}>{t('pallet.btn_logo_export')}</Button>
          <Button
            type="primary"
            danger={false}
            loading={closeMutation.isPending}
            disabled={rows.length === 0}
            onClick={handleCloseManifest}
          >
            {t('pallet.btn_close_manifest')}
          </Button>
        </div>
      </Flex>

      <Alert
        type="info"
        showIcon
        message={t('pallet.banner_source_of_truth')}
        style={{ marginBottom: 16 }}
      />

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
        title={
          <span>
            {t('pallet.stat_pallets')} ({rows.length})
          </span>
        }
        extra={
          <Flex gap={8}>
            <Button size="small" onClick={handleAddPallet}>{t('pallet.btn_add_pallet')}</Button>
            <Button
              size="small"
              type="primary"
              loading={upsertMutation.isPending}
              onClick={handleSave}
            >
              {t('pallet.btn_save')}
            </Button>
          </Flex>
        }
      >
        {rows.length === 0 ? (
          <Text type="secondary">{t('pallet.empty_state')}</Text>
        ) : (
          <PalletTable
            rows={rows}
            crateWeightMap={crateWeightMap}
            onChangeRow={handleChangeRow}
          />
        )}
      </Card>

      {shipmentId != null && (
        <VarietyRollupCard
          rows={rows}
          crateWeightMap={crateWeightMap}
          shipmentId={shipmentId}
        />
      )}
    </div>
  );
}
