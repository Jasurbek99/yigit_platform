import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Tag,
  ColorPicker,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useShipmentOptions,
  useCreateShipmentOption,
  useUpdateShipmentOption,
  useDeleteShipmentOption,
  useCountries,
  useCreateCountry,
  useUpdateCountry,
  useDeleteCountry,
  useCities,
  useCreateCity,
  useUpdateCity,
  useDeleteCity,
  useAdminCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  useAdminImportFirms,
  useCreateImportFirm,
  useUpdateImportFirm,
  useDeleteImportFirm,
  useAdminFirms,
  useCreateFirm,
  useUpdateFirm,
  useDeleteExportFirm,
  useTomatoVarieties,
  useCreateTomatoVariety,
  useUpdateTomatoVariety,
  useDeleteTomatoVariety,
  useBorderPoints,
  useCreateBorderPoint,
  useUpdateBorderPoint,
  useDeleteBorderPoint,
  useAdminBlocks,
  useCreateBlock,
  useUpdateBlock,
  useDeleteBlock,
} from '@/hooks/useAdmin';
import type {
  IShipmentOptionType,
  ICountry,
  ICity,
  ICustomer,
  IImportFirm,
  IExportFirm,
  ITomatoVariety,
  IBorderPoint,
  IGreenhouseBlock,
} from '@/types';

const { Text } = Typography;

interface IProps {
  canWrite: boolean;
}

// ─── Category taxonomy ──────────────────────────────────────────────────────
// "Option" categories live in ShipmentOptionType (full CRUD: code, labels,
// icon, color, sort, status). "FK" categories live in their own reference
// tables (Country, City, …). The FK flow here exposes the key identity fields
// + color + sort_order + status. For richer fields (addresses, bank details,
// file uploads) admins still go to the dedicated detail pages.

const SHIPMENT_OPTION_CATEGORIES = [
  'vehicle_condition',
  'documents_status',
  'harvest_status',
  'transport_responsible',
] as const;

const FK_CATEGORIES = [
  'country',
  'city',
  'customer',
  'import_firm',
  'export_firm',
  'variety',
  'border_point',
  'block',
] as const;

type ShipmentOptionCategory = (typeof SHIPMENT_OPTION_CATEGORIES)[number];
type FKCategory = (typeof FK_CATEGORIES)[number];
type Category = ShipmentOptionCategory | FKCategory;

function isFKCategory(cat: Category): cat is FKCategory {
  return (FK_CATEGORIES as readonly string[]).includes(cat);
}

interface IShipmentOptionFormValues {
  code: string;
  label_tk: string;
  label_en: string | null;
  label_ru: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

// One loose shape covering every per-category field. Antd Form lets us set /
// read these regardless of which subset is rendered; we trim on submit.
interface IFKFormValues {
  // names (different per category)
  name?: string | null;
  name_tk?: string | null;
  name_en?: string | null;
  name_ru?: string | null;
  name_local?: string | null;
  name_company?: string | null;
  name_short?: string | null;
  // identifiers
  code?: string | null;
  // contact
  phone?: string | null;
  // FK refs
  country?: number | null;
  city?: number | null;
  default_country?: number | null;
  default_city?: number | null;
  // misc
  type?: string | null;
  route_description?: string | null;
  typical_transit_days?: number | null;
  // shared
  color?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

// Normalized row shape for the FK table — only the columns the table shows.
interface IFKRow {
  id: number;
  display_name: string;
  display_code: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

const normalizeCountry = (c: ICountry): IFKRow => ({
  id: c.id,
  display_name: c.name_en || c.name_tk,
  display_code: c.code,
  color: c.color ?? null,
  sort_order: c.sort_order ?? 0,
  is_active: true,
});
const normalizeCity = (c: ICity): IFKRow => ({
  id: c.id,
  display_name: c.name,
  display_code: c.name_local ?? null,
  color: c.color ?? null,
  sort_order: c.sort_order ?? 0,
  is_active: true,
});
const normalizeCustomer = (c: ICustomer): IFKRow => ({
  id: c.id,
  display_name: c.name,
  display_code: null,
  color: c.color ?? null,
  sort_order: c.sort_order ?? 0,
  is_active: c.is_active,
});
const normalizeImportFirm = (f: IImportFirm): IFKRow => ({
  id: f.id,
  display_name: f.name_short || f.name_company,
  display_code: f.code,
  color: f.color ?? null,
  sort_order: f.sort_order ?? 0,
  is_active: f.is_active,
});
const normalizeExportFirm = (f: IExportFirm): IFKRow => ({
  id: f.id,
  display_name: f.name_en || f.name_tk,
  display_code: f.code,
  color: f.color ?? null,
  sort_order: f.sort_order ?? 0,
  is_active: f.is_active,
});
const normalizeVariety = (v: ITomatoVariety): IFKRow => ({
  id: v.id,
  display_name: v.name,
  display_code: v.code,
  color: v.color ?? null,
  sort_order: v.sort_order ?? 0,
  is_active: true,
});
const normalizeBorderPoint = (b: IBorderPoint): IFKRow => ({
  id: b.id,
  display_name: b.name,
  display_code: null,
  color: b.color ?? null,
  sort_order: b.sort_order ?? 0,
  is_active: b.is_active,
});
const normalizeBlock = (b: IGreenhouseBlock): IFKRow => ({
  id: b.id,
  display_name: b.name || b.code,
  display_code: b.code,
  color: b.color ?? null,
  sort_order: b.sort_order ?? 0,
  is_active: b.is_active,
});

export default function OptionListsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<Category>('vehicle_condition');

  // ── ShipmentOption editing ─────────────────────────────────────────────────
  const [optModalOpen, setOptModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IShipmentOptionType | null>(null);
  const [form] = Form.useForm<IShipmentOptionFormValues>();
  const isShipmentOption = !isFKCategory(category);
  const { data: options = [], isLoading: optionsLoading } = useShipmentOptions(
    isShipmentOption ? (category as ShipmentOptionCategory) : undefined,
  );

  function closeOptionModal() {
    setOptModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  const createOption = useCreateShipmentOption({
    onSuccess: () => { toast.success(t('shipment_settings.toast_created')); closeOptionModal(); },
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });
  const updateOption = useUpdateShipmentOption({
    onSuccess: () => { toast.success(t('shipment_settings.toast_updated')); closeOptionModal(); },
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });
  const deleteOption = useDeleteShipmentOption({
    onSuccess: () => toast.success(t('shipment_settings.toast_deleted')),
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });

  function handleCreateOption() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ sort_order: (options.length + 1) * 10, is_active: true });
    setOptModalOpen(true);
  }

  function handleEditOption(record: IShipmentOptionType) {
    setEditTarget(record);
    form.setFieldsValue({
      code: record.code,
      label_tk: record.label_tk,
      label_en: record.label_en,
      label_ru: record.label_ru,
      icon: record.icon,
      color: record.color ?? null,
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setOptModalOpen(true);
  }

  function handleDeleteOption(id: number) {
    Modal.confirm({
      title: t('shipment_settings.confirm_delete'),
      onOk: () => deleteOption.mutate(id),
    });
  }

  function handleOptionSubmit(values: IShipmentOptionFormValues) {
    if (editTarget) {
      updateOption.mutate({ id: editTarget.id, ...values });
    } else {
      createOption.mutate({ ...values, category: category as ShipmentOptionCategory });
    }
  }

  // ── FK queries ─────────────────────────────────────────────────────────────
  const countriesQ = useCountries();
  const citiesQ = useCities();
  const customersQ = useAdminCustomers();
  const importFirmsQ = useAdminImportFirms();
  const exportFirmsQ = useAdminFirms();
  const varietiesQ = useTomatoVarieties();
  const borderPointsQ = useBorderPoints();
  const blocksQ = useAdminBlocks();

  // Country/City options for FK selects in the modal
  const countrySelectOptions = (countriesQ.data ?? []).map((c) => ({
    value: c.id,
    label: c.name_en || c.name_tk,
  }));
  const citySelectOptions = (citiesQ.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  // ── FK CRUD mutations ──────────────────────────────────────────────────────
  const tCreated = () => toast.success(t('shipment_settings.toast_created'));
  const tUpdated = () => toast.success(t('shipment_settings.toast_updated'));
  const tDeleted = () => toast.success(t('shipment_settings.toast_deleted'));
  const tError = () => toast.error(t('shipment_settings.toast_error'));

  const cCountry = useCreateCountry({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uCountry = useUpdateCountry({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dCountry = useDeleteCountry({ onSuccess: tDeleted, onError: tError });
  const cCity = useCreateCity({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uCity = useUpdateCity({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dCity = useDeleteCity({ onSuccess: tDeleted, onError: tError });
  const cCustomer = useCreateCustomer({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uCustomer = useUpdateCustomer({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dCustomer = useDeleteCustomer({ onSuccess: tDeleted, onError: tError });
  const cImportFirm = useCreateImportFirm({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uImportFirm = useUpdateImportFirm({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dImportFirm = useDeleteImportFirm({ onSuccess: tDeleted, onError: tError });
  const cExportFirm = useCreateFirm({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uExportFirm = useUpdateFirm({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dExportFirm = useDeleteExportFirm({ onSuccess: tDeleted, onError: tError });
  const cVariety = useCreateTomatoVariety({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uVariety = useUpdateTomatoVariety({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dVariety = useDeleteTomatoVariety({ onSuccess: tDeleted, onError: tError });
  const cBorderPoint = useCreateBorderPoint({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uBorderPoint = useUpdateBorderPoint({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dBorderPoint = useDeleteBorderPoint({ onSuccess: tDeleted, onError: tError });
  const cBlock = useCreateBlock({ onSuccess: () => { tCreated(); closeFkModal(); }, onError: tError });
  const uBlock = useUpdateBlock({ onSuccess: () => { tUpdated(); closeFkModal(); }, onError: tError });
  const dBlock = useDeleteBlock({ onSuccess: tDeleted, onError: tError });

  // Inline color saver — dispatches PATCH({color}) to the right FK mutation
  // based on the current category. Used by the FK table's color column for
  // edit-in-place (no modal needed for a color change).
  function saveFkColor(id: number, color: string | null) {
    switch (category) {
      case 'country': uCountry.mutate({ id, color }); break;
      case 'city': uCity.mutate({ id, color }); break;
      case 'customer': uCustomer.mutate({ id, color }); break;
      case 'import_firm': uImportFirm.mutate({ id, color }); break;
      case 'export_firm': uExportFirm.mutate({ id, color }); break;
      case 'variety': uVariety.mutate({ id, color }); break;
      case 'border_point': uBorderPoint.mutate({ id, color }); break;
      case 'block': uBlock.mutate({ id, color }); break;
    }
  }

  // Sort-order saver — same dispatch shape as saveFkColor; called once per row
  // whose position changed after a drag-and-drop reorder.
  function saveFkSortOrder(id: number, sort_order: number) {
    switch (category) {
      case 'country': uCountry.mutate({ id, sort_order }); break;
      case 'city': uCity.mutate({ id, sort_order }); break;
      case 'customer': uCustomer.mutate({ id, sort_order }); break;
      case 'import_firm': uImportFirm.mutate({ id, sort_order }); break;
      case 'export_firm': uExportFirm.mutate({ id, sort_order }); break;
      case 'variety': uVariety.mutate({ id, sort_order }); break;
      case 'border_point': uBorderPoint.mutate({ id, sort_order }); break;
      case 'block': uBlock.mutate({ id, sort_order }); break;
    }
  }

  // dnd-kit sensors — 5px activation distance prevents accidental drags on
  // simple clicks (Edit/Delete buttons sit on the same rows).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Drag-end handler for the ShipmentOption table. Renumbers every visible row
  // with `(idx + 1) * 10` and patches only the rows whose sort_order actually
  // changed — keeps PATCH traffic bounded to what the user moved through.
  function handleOptionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sortedOptions = [...options].sort((a, b) => a.sort_order - b.sort_order);
    const oldIndex = sortedOptions.findIndex((o) => o.id === active.id);
    const newIndex = sortedOptions.findIndex((o) => o.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sortedOptions, oldIndex, newIndex);
    reordered.forEach((row, idx) => {
      const newSort = (idx + 1) * 10;
      if (row.sort_order !== newSort) {
        updateOption.mutate({ id: row.id, sort_order: newSort });
      }
    });
  }

  // Same pattern for FK tables. Filtered rows are dragged in their currently
  // visible order — they keep their `sort_order` slots; the assignment only
  // affects the rows displayed.
  function handleFkDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const sorted = [...fkState.rows].sort((a, b) => a.sort_order - b.sort_order);
    const oldIndex = sorted.findIndex((r) => r.id === active.id);
    const newIndex = sorted.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    reordered.forEach((row, idx) => {
      const newSort = (idx + 1) * 10;
      if (row.sort_order !== newSort) {
        saveFkSortOrder(row.id, newSort);
      }
    });
  }

  // Resolve rows + loading for the selected FK category.
  const fkState = useMemo(() => {
    switch (category) {
      case 'country':
        return { rows: (countriesQ.data ?? []).map(normalizeCountry), isLoading: countriesQ.isLoading };
      case 'city':
        return { rows: (citiesQ.data ?? []).map(normalizeCity), isLoading: citiesQ.isLoading };
      case 'customer':
        return { rows: (customersQ.data ?? []).map(normalizeCustomer), isLoading: customersQ.isLoading };
      case 'import_firm':
        return { rows: (importFirmsQ.data ?? []).map(normalizeImportFirm), isLoading: importFirmsQ.isLoading };
      case 'export_firm':
        return { rows: (exportFirmsQ.data ?? []).map(normalizeExportFirm), isLoading: exportFirmsQ.isLoading };
      case 'variety':
        return { rows: (varietiesQ.data ?? []).map(normalizeVariety), isLoading: varietiesQ.isLoading };
      case 'border_point':
        return { rows: (borderPointsQ.data ?? []).map(normalizeBorderPoint), isLoading: borderPointsQ.isLoading };
      case 'block':
        return { rows: (blocksQ.data ?? []).map(normalizeBlock), isLoading: blocksQ.isLoading };
      default:
        return { rows: [] as IFKRow[], isLoading: false };
    }
  }, [
    category,
    countriesQ.data, countriesQ.isLoading,
    citiesQ.data, citiesQ.isLoading,
    customersQ.data, customersQ.isLoading,
    importFirmsQ.data, importFirmsQ.isLoading,
    exportFirmsQ.data, exportFirmsQ.isLoading,
    varietiesQ.data, varietiesQ.isLoading,
    borderPointsQ.data, borderPointsQ.isLoading,
    blocksQ.data, blocksQ.isLoading,
  ]);

  const [fkSearch, setFkSearch] = useState('');
  const fkRowsFiltered = useMemo(() => {
    if (!fkSearch) return fkState.rows;
    const q = fkSearch.toLowerCase();
    return fkState.rows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        (r.display_code ?? '').toLowerCase().includes(q),
    );
  }, [fkState.rows, fkSearch]);

  // ── FK modal ───────────────────────────────────────────────────────────────
  const [fkModalOpen, setFkModalOpen] = useState(false);
  const [fkEditTargetId, setFkEditTargetId] = useState<number | null>(null);
  const [fkForm] = Form.useForm<IFKFormValues>();

  function closeFkModal() {
    setFkModalOpen(false);
    setFkEditTargetId(null);
    fkForm.resetFields();
  }

  function handleCreateFk() {
    setFkEditTargetId(null);
    fkForm.resetFields();
    fkForm.setFieldsValue({ sort_order: (fkState.rows.length + 1) * 10, is_active: true });
    setFkModalOpen(true);
  }

  function handleEditFk(row: IFKRow) {
    setFkEditTargetId(row.id);
    // Pre-fill from the matching raw record (table-specific shape).
    const initial = collectInitialFormValues(category, row.id, {
      countries: countriesQ.data ?? [],
      cities: citiesQ.data ?? [],
      customers: customersQ.data ?? [],
      importFirms: importFirmsQ.data ?? [],
      exportFirms: exportFirmsQ.data ?? [],
      varieties: varietiesQ.data ?? [],
      borderPoints: borderPointsQ.data ?? [],
      blocks: blocksQ.data ?? [],
    });
    fkForm.setFieldsValue(initial);
    setFkModalOpen(true);
  }

  function handleDeleteFk(row: IFKRow) {
    Modal.confirm({
      title: t('shipment_settings.confirm_delete'),
      content: row.display_name,
      okType: 'danger',
      onOk: () => {
        switch (category) {
          case 'country': dCountry.mutate(row.id); break;
          case 'city': dCity.mutate(row.id); break;
          case 'customer': dCustomer.mutate(row.id); break;
          case 'import_firm': dImportFirm.mutate(row.id); break;
          case 'export_firm': dExportFirm.mutate(row.id); break;
          case 'variety': dVariety.mutate(row.id); break;
          case 'border_point': dBorderPoint.mutate(row.id); break;
          case 'block': dBlock.mutate(row.id); break;
        }
      },
    });
  }

  function handleFkSubmit(values: IFKFormValues) {
    const isCreate = fkEditTargetId === null;
    const id = fkEditTargetId ?? 0;
    switch (category) {
      case 'country': {
        const payload = {
          name_tk: values.name_tk ?? '',
          name_en: values.name_en ?? undefined,
          name_ru: values.name_ru ?? undefined,
          code: values.code ?? undefined,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
        };
        if (isCreate) cCountry.mutate(payload);
        else uCountry.mutate({ id, ...payload });
        break;
      }
      case 'city': {
        const payload = {
          name: values.name ?? '',
          country: values.country as number,
          name_local: values.name_local ?? undefined,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
        };
        if (isCreate) cCity.mutate(payload);
        else uCity.mutate({ id, ...payload });
        break;
      }
      case 'customer': {
        const payload = {
          name: values.name ?? '',
          phone: values.phone ?? null,
          default_country: values.default_country ?? null,
          default_city: values.default_city ?? null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
        };
        if (isCreate) cCustomer.mutate(payload);
        else uCustomer.mutate({ id, ...payload });
        break;
      }
      case 'import_firm': {
        const payload = {
          code: values.code ?? null,
          name_company: values.name_company ?? '',
          name_short: values.name_short ?? null,
          country: values.country ?? null,
          city: values.city ?? null,
          address: null,
          bank_details: null,
          contact_person: null,
          phone: values.phone ?? null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
          is_gapy_satys: false,
        };
        if (isCreate) cImportFirm.mutate(payload);
        else uImportFirm.mutate({ id, ...payload });
        break;
      }
      case 'export_firm': {
        const payload = {
          code: values.code ?? '',
          name_tk: values.name_tk ?? '',
          name_en: values.name_en ?? null,
          name_ru: values.name_ru ?? null,
          address_tk: null,
          address_en: null,
          address_ru: null,
          bank_details_tk: null,
          bank_details_en: null,
          bank_details_ru: null,
          director: null,
          tax_code: null,
          swift_code: null,
          one_c_code: null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
          is_gapy_satys: false,
        };
        if (isCreate) cExportFirm.mutate(payload);
        else uExportFirm.mutate({ id, ...payload });
        break;
      }
      case 'variety': {
        const payload = {
          name: values.name ?? '',
          code: values.code ?? null,
          type: values.type ?? null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
        };
        if (isCreate) cVariety.mutate(payload);
        else uVariety.mutate({ id, ...payload });
        break;
      }
      case 'border_point': {
        const payload = {
          name: values.name ?? '',
          route_description: values.route_description ?? null,
          typical_transit_days: values.typical_transit_days ?? null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
        };
        if (isCreate) cBorderPoint.mutate(payload);
        else uBorderPoint.mutate({ id, ...payload });
        break;
      }
      case 'block': {
        const payload = {
          code: values.code ?? '',
          name: values.name ?? null,
          parent: null,
          parent_code: null,
          manager: null,
          variety_main: null,
          variety_main_name: null,
          variety_secondary: null,
          variety_secondary_name: null,
          area_m2: null,
          location: null,
          location_name: null,
          section_count: null,
          sowing_date: null,
          season_start_month: null,
          color: values.color ?? null,
          sort_order: values.sort_order ?? 0,
          is_active: values.is_active ?? true,
          sub_blocks: [],
        };
        if (isCreate) cBlock.mutate(payload);
        else uBlock.mutate({ id, ...payload });
        break;
      }
    }
  }

  // ─── Category dropdown ─────────────────────────────────────────────────────
  const categoryOptions = [
    ...SHIPMENT_OPTION_CATEGORIES.map((cat) => ({
      value: cat,
      label: t(`shipment_settings.category_${cat}`),
    })),
    ...FK_CATEGORIES.map((cat) => ({
      value: cat,
      label: t(`shipment_settings.category_${cat}`),
    })),
  ];

  // ─── ShipmentOption table columns ──────────────────────────────────────────
  const dragHandleColumn = canWrite
    ? [{
        title: '',
        key: 'drag',
        width: 36,
        render: () => <DragHandle />,
      }]
    : [];

  const optionColumns = [
    ...dragHandleColumn,
    { title: t('shipment_settings.col_code'), dataIndex: 'code', key: 'code', width: 160, render: (v: string) => <code>{v}</code> },
    { title: t('shipment_settings.col_label_tk'), dataIndex: 'label_tk', key: 'label_tk' },
    { title: t('shipment_settings.col_label_en'), dataIndex: 'label_en', key: 'label_en', render: (v: string | null) => v ?? '—' },
    { title: t('shipment_settings.col_label_ru'), dataIndex: 'label_ru', key: 'label_ru', render: (v: string | null) => v ?? '—' },
    { title: t('shipment_settings.col_icon'), dataIndex: 'icon', key: 'icon', width: 80, render: (v: string | null) => v ?? '—' },
    {
      title: t('shipment_settings.col_color'),
      dataIndex: 'color',
      key: 'color',
      width: 150,
      render: (_: unknown, record: IShipmentOptionType) =>
        canWrite ? (
          <InlineColorPicker
            value={record.color ?? null}
            onSave={(color) => updateOption.mutate({ id: record.id, color })}
          />
        ) : (
          renderColorCell(record.color ?? null)
        ),
    },
    {
      title: t('shipment_settings.col_sort'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      sorter: (a: IShipmentOptionType, b: IShipmentOptionType) => a.sort_order - b.sort_order,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('shipment_settings.col_status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>{v ? t('common.active') : t('common.inactive')}</Tag>
      ),
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: IShipmentOptionType) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditOption(record)} />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteOption(record.id)} />
              </Space>
            ),
          },
        ]
      : []),
  ];

  // ─── FK table columns ──────────────────────────────────────────────────────
  const fkColumns = [
    ...dragHandleColumn,
    {
      title: t('shipment_settings.col_code'),
      dataIndex: 'display_code',
      key: 'display_code',
      width: 140,
      render: (v: string | null) => (v ? <code>{v}</code> : <Text type="secondary">—</Text>),
    },
    {
      title: t('shipment_settings.col_name'),
      dataIndex: 'display_name',
      key: 'display_name',
      sorter: (a: IFKRow, b: IFKRow) => a.display_name.localeCompare(b.display_name),
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: t('shipment_settings.col_color'),
      dataIndex: 'color',
      key: 'color',
      width: 150,
      render: (_: unknown, record: IFKRow) =>
        canWrite ? (
          <InlineColorPicker
            value={record.color}
            onSave={(color) => saveFkColor(record.id, color)}
          />
        ) : (
          renderColorCell(record.color)
        ),
    },
    {
      title: t('shipment_settings.col_sort'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      sorter: (a: IFKRow, b: IFKRow) => a.sort_order - b.sort_order,
      defaultSortOrder: 'ascend' as const,
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: IFKRow) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditFk(record)} />
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteFk(record)} />
              </Space>
            ),
          },
        ]
      : []),
  ];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space>
          <span>{t('shipment_settings.category_label')}:</span>
          <Select
            value={category}
            onChange={(v: Category) => {
              setCategory(v);
              setFkSearch('');
            }}
            options={categoryOptions}
            style={{ width: 240 }}
          />
          {isFKCategory(category) && (
            <Input.Search
              allowClear
              placeholder={t('common.search')}
              value={fkSearch}
              onChange={(e) => setFkSearch(e.target.value)}
              style={{ width: 240 }}
            />
          )}
        </Space>
        {canWrite && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={isShipmentOption ? handleCreateOption : handleCreateFk}
          >
            {t('shipment_settings.add')}
          </Button>
        )}
      </div>

      {isShipmentOption ? (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleOptionDragEnd}
        >
          <SortableContext
            items={options.map((o) => o.id)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={optionColumns}
              dataSource={[...options].sort((a, b) => a.sort_order - b.sort_order)}
              rowKey="id"
              loading={optionsLoading}
              pagination={false}
              size="small"
              bordered
              scroll={{ x: 'max-content' }}
              components={{ body: { row: DraggableRow } }}
            />
          </SortableContext>
        </DndContext>
      ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleFkDragEnd}
        >
          <SortableContext
            items={fkRowsFiltered.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={fkColumns}
              dataSource={fkRowsFiltered}
              rowKey="id"
              loading={fkState.isLoading}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              size="small"
              bordered
              scroll={{ x: 'max-content' }}
              components={{ body: { row: DraggableRow } }}
            />
          </SortableContext>
        </DndContext>
      )}

      {/* ShipmentOption create/edit modal */}
      <Modal
        title={editTarget ? t('shipment_settings.edit') : t('shipment_settings.add')}
        open={optModalOpen}
        onCancel={closeOptionModal}
        onOk={() => form.submit()}
        confirmLoading={createOption.isPending || updateOption.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleOptionSubmit}>
          <Form.Item name="code" label={t('shipment_settings.col_code')} rules={[{ required: true, message: t('common.required') }]}>
            <Input disabled={editTarget !== null} placeholder={t('shipment_settings.placeholder_option_code')} />
          </Form.Item>
          <Form.Item name="label_tk" label={t('shipment_settings.col_label_tk')} rules={[{ required: true, message: t('common.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="label_en" label={t('shipment_settings.col_label_en')}><Input /></Form.Item>
          <Form.Item name="label_ru" label={t('shipment_settings.col_label_ru')}><Input /></Form.Item>
          <Form.Item name="icon" label={t('shipment_settings.col_icon')}>
            <Input placeholder={t('shipment_settings.placeholder_option_icon')} />
          </Form.Item>
          <Form.Item name="color" label={t('shipment_settings.col_color')}><ColorInput /></Form.Item>
          <Form.Item name="sort_order" label={t('shipment_settings.col_sort')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editTarget && (
            <Form.Item name="is_active" label={t('shipment_settings.col_status')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* FK create/edit modal — fields rendered conditionally per category. */}
      <Modal
        title={
          fkEditTargetId !== null
            ? t('shipment_settings.edit')
            : t('shipment_settings.add')
        }
        open={fkModalOpen}
        onCancel={closeFkModal}
        onOk={() => fkForm.submit()}
        destroyOnHidden
      >
        <Form form={fkForm} layout="vertical" onFinish={handleFkSubmit}>
          {category === 'country' && (
            <>
              <Form.Item name="name_tk" label={t('shipment_settings.col_label_tk')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_en" label={t('shipment_settings.col_label_en')}><Input /></Form.Item>
              <Form.Item name="name_ru" label={t('shipment_settings.col_label_ru')}><Input /></Form.Item>
              <Form.Item name="code" label={t('shipment_settings.col_code')}><Input /></Form.Item>
            </>
          )}
          {category === 'city' && (
            <>
              <Form.Item name="country" label={t('shipment_settings.category_country')} rules={[{ required: true, message: t('common.required') }]}>
                <Select options={countrySelectOptions} showSearch optionFilterProp="label" allowClear />
              </Form.Item>
              <Form.Item name="name" label={t('shipment_settings.col_name')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_local" label={t('shipment_settings.col_name_local')}><Input /></Form.Item>
            </>
          )}
          {category === 'customer' && (
            <>
              <Form.Item name="name" label={t('shipment_settings.col_name')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="phone" label={t('shipment_settings.col_phone')}><Input /></Form.Item>
              <Form.Item name="default_country" label={t('shipment_settings.category_country')}>
                <Select options={countrySelectOptions} showSearch optionFilterProp="label" allowClear />
              </Form.Item>
              <Form.Item name="default_city" label={t('shipment_settings.category_city')}>
                <Select options={citySelectOptions} showSearch optionFilterProp="label" allowClear />
              </Form.Item>
            </>
          )}
          {category === 'import_firm' && (
            <>
              <Form.Item name="name_company" label={t('shipment_settings.col_name_company')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_short" label={t('shipment_settings.col_name_short')}><Input /></Form.Item>
              <Form.Item name="code" label={t('shipment_settings.col_code')}><Input /></Form.Item>
              <Form.Item name="country" label={t('shipment_settings.category_country')}>
                <Select options={countrySelectOptions} showSearch optionFilterProp="label" allowClear />
              </Form.Item>
              <Form.Item name="city" label={t('shipment_settings.category_city')}>
                <Select options={citySelectOptions} showSearch optionFilterProp="label" allowClear />
              </Form.Item>
              <Form.Item name="phone" label={t('shipment_settings.col_phone')}><Input /></Form.Item>
            </>
          )}
          {category === 'export_firm' && (
            <>
              <Form.Item name="code" label={t('shipment_settings.col_code')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_tk" label={t('shipment_settings.col_label_tk')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name_en" label={t('shipment_settings.col_label_en')}><Input /></Form.Item>
              <Form.Item name="name_ru" label={t('shipment_settings.col_label_ru')}><Input /></Form.Item>
            </>
          )}
          {category === 'variety' && (
            <>
              <Form.Item name="name" label={t('shipment_settings.col_name')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="code" label={t('shipment_settings.col_code')}><Input /></Form.Item>
              <Form.Item name="type" label={t('shipment_settings.col_type')}><Input /></Form.Item>
            </>
          )}
          {category === 'border_point' && (
            <>
              <Form.Item name="name" label={t('shipment_settings.col_name')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="route_description" label={t('shipment_settings.col_route')}><Input /></Form.Item>
              <Form.Item name="typical_transit_days" label={t('shipment_settings.col_days')}>
                <InputNumber min={0} max={60} style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          {category === 'block' && (
            <>
              <Form.Item name="code" label={t('shipment_settings.col_code')} rules={[{ required: true, message: t('common.required') }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name" label={t('shipment_settings.col_name')}><Input /></Form.Item>
            </>
          )}
          <Form.Item name="color" label={t('shipment_settings.col_color')}>
            <ColorInput />
          </Form.Item>
          <Form.Item name="sort_order" label={t('shipment_settings.col_sort')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {/* is_active toggle only on tables that have the field */}
          {fkEditTargetId !== null &&
            (category === 'customer' ||
              category === 'import_firm' ||
              category === 'export_firm' ||
              category === 'border_point' ||
              category === 'block') && (
              <Form.Item name="is_active" label={t('shipment_settings.col_status')} valuePropName="checked">
                <Switch />
              </Form.Item>
            )}
        </Form>
      </Modal>
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface IFKCaches {
  countries: ICountry[];
  cities: ICity[];
  customers: ICustomer[];
  importFirms: IImportFirm[];
  exportFirms: IExportFirm[];
  varieties: ITomatoVariety[];
  borderPoints: IBorderPoint[];
  blocks: IGreenhouseBlock[];
}

function collectInitialFormValues(
  category: Category,
  id: number,
  caches: IFKCaches,
): IFKFormValues {
  switch (category) {
    case 'country': {
      const r = caches.countries.find((x) => x.id === id);
      if (!r) return {};
      return {
        name_tk: r.name_tk, name_en: r.name_en, name_ru: r.name_ru,
        code: r.code, color: r.color ?? null, sort_order: r.sort_order ?? 0,
      };
    }
    case 'city': {
      const r = caches.cities.find((x) => x.id === id);
      if (!r) return {};
      return {
        country: r.country, name: r.name, name_local: r.name_local,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
      };
    }
    case 'customer': {
      const r = caches.customers.find((x) => x.id === id);
      if (!r) return {};
      return {
        name: r.name, phone: r.phone,
        default_country: r.default_country, default_city: r.default_city,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
        is_active: r.is_active,
      };
    }
    case 'import_firm': {
      const r = caches.importFirms.find((x) => x.id === id);
      if (!r) return {};
      return {
        name_company: r.name_company, name_short: r.name_short, code: r.code,
        country: r.country, city: r.city, phone: r.phone,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
        is_active: r.is_active,
      };
    }
    case 'export_firm': {
      const r = caches.exportFirms.find((x) => x.id === id);
      if (!r) return {};
      return {
        code: r.code, name_tk: r.name_tk, name_en: r.name_en, name_ru: r.name_ru,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
        is_active: r.is_active,
      };
    }
    case 'variety': {
      const r = caches.varieties.find((x) => x.id === id);
      if (!r) return {};
      return {
        name: r.name, code: r.code, type: r.type,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
      };
    }
    case 'border_point': {
      const r = caches.borderPoints.find((x) => x.id === id);
      if (!r) return {};
      return {
        name: r.name, route_description: r.route_description,
        typical_transit_days: r.typical_transit_days,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
        is_active: r.is_active,
      };
    }
    case 'block': {
      const r = caches.blocks.find((x) => x.id === id);
      if (!r) return {};
      return {
        code: r.code, name: r.name,
        color: r.color ?? null, sort_order: r.sort_order ?? 0,
        is_active: r.is_active,
      };
    }
    default:
      return {};
  }
}

// ─── Drag-and-drop row ─────────────────────────────────────────────────────
// Antd Table lets us replace the row element via `components.body.row`. The
// row uses useSortable for movement; only the small DragHandle column carries
// the pointer-down listener so clicking on Edit/Delete buttons does NOT start
// a drag. The listeners ref is passed to the handle via context.

const RowDragContext = createContext<ReturnType<typeof useSortable>['listeners']>(undefined);

interface IDraggableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  'data-row-key'?: string | number;
}

function DraggableRow({ children, ...props }: IDraggableRowProps) {
  const rowKey = props['data-row-key'];
  const id = typeof rowKey === 'string' ? Number(rowKey) : (rowKey ?? 0);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    ...props.style,
    // scaleY:1 keeps row height stable even when antd applies its own transforms.
    transform: CSS.Transform.toString(transform ? { ...transform, scaleY: 1 } : null),
    transition,
    ...(isDragging
      ? { position: 'relative', zIndex: 9999, background: '#fafafa' }
      : {}),
  };
  return (
    <RowDragContext.Provider value={listeners}>
      <tr {...props} {...attributes} ref={setNodeRef} style={style}>
        {children}
      </tr>
    </RowDragContext.Provider>
  );
}

function DragHandle() {
  const listeners = useContext(RowDragContext);
  return (
    <Button
      size="small"
      type="text"
      icon={<HolderOutlined />}
      {...listeners}
      style={{ cursor: 'grab', touchAction: 'none' }}
    />
  );
}

// ─── Inline ColorPicker for table cells ─────────────────────────────────────
// Used in the table's color column for edit-in-place. Antd's onChangeComplete
// fires once when the user releases the pointer; onClear fires when the X is
// clicked. Both call onSave directly — no modal round-trip needed.

interface IInlineColorPickerProps {
  value: string | null;
  onSave: (color: string | null) => void;
}

function InlineColorPicker({ value, onSave }: IInlineColorPickerProps) {
  return (
    <ColorPicker
      value={value ?? undefined}
      format="hex"
      allowClear
      showText
      disabledAlpha
      onChangeComplete={(c) => {
        const hex = c.toHexString();
        if (hex && hex !== value) onSave(hex);
      }}
      onClear={() => {
        if (value !== null) onSave(null);
      }}
    />
  );
}

// ─── Combined ColorPicker + Input ───────────────────────────────────────────
interface IColorInputProps {
  value?: string | null;
  onChange?: (next: string | null) => void;
}

function ColorInput({ value, onChange }: IColorInputProps) {
  const [text, setText] = useState<string>(value ?? '');

  useEffect(() => {
    setText(value ?? '');
  }, [value]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange?.(null);
      return;
    }
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    const short = /^#([0-9a-fA-F]{3})$/.exec(withHash);
    const long = /^#([0-9a-fA-F]{6})$/.test(withHash);
    if (short) {
      const [r, g, b] = short[1];
      onChange?.(`#${r}${r}${g}${g}${b}${b}`.toLowerCase());
      return;
    }
    if (long) {
      onChange?.(withHash.toLowerCase());
      return;
    }
    setText(value ?? '');
  }

  return (
    <Space.Compact style={{ width: '100%' }}>
      <ColorPicker
        value={value ?? undefined}
        format="hex"
        allowClear
        disabledAlpha
        onChangeComplete={(c) => onChange?.(c.toHexString())}
        onClear={() => onChange?.(null)}
      />
      <Input
        value={text}
        placeholder="#00ff00"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onPressEnter={() => commit(text)}
        style={{ flex: 1 }}
        allowClear
      />
    </Space.Compact>
  );
}

function renderColorCell(v: string | null) {
  if (!v) return '—';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 18,
          height: 18,
          background: v,
          border: '1px solid #d9d9d9',
          borderRadius: 3,
        }}
      />
      <code style={{ fontSize: 11 }}>{v}</code>
    </span>
  );
}
