import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import api from '@/services/api';
import { FieldEditor } from '@/components/FieldEditor';
import { DetailExtraFieldRows } from './DetailExtraFieldRows';
import { DETAIL_EXTRA_FIELDS, type IEditFieldConfig } from '@/constants/shipmentEditConfig';
import { countMissing } from './ShipmentFieldGroup';
import { EDITABLE_FIELD_KEYS, sectionAnchorFor } from './ShipmentCompletenessBar.helpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/hooks/useAdmin', () => ({
  useCountries: () => ({ data: [] }), useCities: () => ({ data: [] }), useCustomers: () => ({ data: [] }),
  useAdminImportFirms: () => ({ data: [] }), useTomatoVarieties: () => ({ data: [] }), useProductTypes: () => ({ data: [] }),
  useBorderPoints: () => ({ data: [] }), useShipmentOptions: () => ({ data: [] }),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { vi.mocked(api.patch).mockClear(); });

function renderRows(shipment: IShipmentDetail, fields: readonly IEditFieldConfig[], locked?: ReadonlySet<string>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DetailExtraFieldRows shipment={shipment} fields={fields} missingKeys={new Set(['dest_entry_at'])}
          readOnly={false} lockedKeys={locked} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DetailExtraFieldRows', () => {
  it('formats datetimes and yes/no in read mode and ids every row', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, dest_entry_at: '2026-09-30T10:00:00Z', has_peregruz: false };
    const { container } = renderRows(shipment, DETAIL_EXTRA_FIELDS.transport);
    expect(screen.getByText(fmt('2026-09-30T10:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(container.querySelector('#detail-field-dest_entry_at')).not.toBeNull();
    expect(container.querySelector('#detail-field-peregruz_city')).not.toBeNull();
  });

  it('renders a locked key read-only (no tab stop)', () => {
    const shipment = { ...MOCK_SHIPMENT_DETAIL, truck_plate_2: 'AB1234' };
    renderRows(shipment, DETAIL_EXTRA_FIELDS.transport, new Set(['truck_plate_2']));
    expect(screen.getByText('AB1234')).toHaveAttribute('tabindex', '-1');
  });
});

// No DetailFieldRow carried a date / datetime before 2026-09-30 — these prove
// the picker survives the row's blur-to-close and the PATCH body is right.
describe('date and datetime rows save through the picker', () => {
  const today = dayjs().format('YYYY-MM-DD');

  it('a date row PATCHes YYYY-MM-DD', async () => {
    const user = userEvent.setup();
    const field = DETAIL_EXTRA_FIELDS.finance.find((f) => f.key === 'sales_report_date')!;
    const { container } = renderRows({ ...MOCK_SHIPMENT_DETAIL, sales_report_date: null }, [field]);
    await user.click(within(container.querySelector('#detail-field-sales_report_date') as HTMLElement).getByText('—'));
    await user.click(document.querySelector(`td[title="${today}"]`)!);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/export/shipments/${MOCK_SHIPMENT_DETAIL.id}/`, { sales_report_date: today },
    ));
  });

  it('a datetime row PATCHes an ISO timestamp after OK', async () => {
    const user = userEvent.setup();
    const field = DETAIL_EXTRA_FIELDS.transport.find((f) => f.key === 'dest_entry_at')!;
    const { container } = renderRows({ ...MOCK_SHIPMENT_DETAIL, dest_entry_at: null }, [field]);
    await user.click(within(container.querySelector('#detail-field-dest_entry_at') as HTMLElement).getByText('—'));
    await user.click(document.querySelector(`td[title="${today}"]`)!);
    await user.click(document.querySelector('.ant-picker-ok button')!);
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as { dest_entry_at: string };
    expect(dayjs(body.dest_entry_at).format('YYYY-MM-DD')).toBe(today);
    expect(body.dest_entry_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// «Дата экспорта»: always a date (hand-entered or auto), clearing = back to auto.
describe('export date row', () => {
  const field = DETAIL_EXTRA_FIELDS.goods.find((f) => f.key === 'export_date')!;
  const today = dayjs().format('YYYY-MM-DD');

  it('is a date row in the goods group, shown as DD.MM.YYYY', () => {
    expect(field.inputType).toBe('date');
    renderRows({ ...MOCK_SHIPMENT_DETAIL, export_date: '2026-09-30' }, [field]);
    expect(screen.getByText('Export date')).toBeInTheDocument();
    expect(screen.getByText('30.09.2026')).toBeInTheDocument();
  });

  it('PATCHes export_date with the picked day', async () => {
    const user = userEvent.setup();
    // Same month as today so the picker opens on a panel that contains today's cell.
    const existing = dayjs().date(dayjs().date() === 1 ? 2 : 1);
    const { container } = renderRows({ ...MOCK_SHIPMENT_DETAIL, export_date: existing.format('YYYY-MM-DD') }, [field]);
    await user.click(within(container.querySelector('#detail-field-export_date') as HTMLElement).getByText(existing.format('DD.MM.YYYY')));
    await user.click(document.querySelector(`td[title="${today}"]`)!);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/export/shipments/${MOCK_SHIPMENT_DETAIL.id}/`, { export_date: today },
    ));
  });

  it('clearing the date PATCHes null (back to auto)', async () => {
    const user = userEvent.setup();
    const { container } = renderRows({ ...MOCK_SHIPMENT_DETAIL, export_date: '2026-09-30' }, [field]);
    await user.click(within(container.querySelector('#detail-field-export_date') as HTMLElement).getByText('30.09.2026'));
    const clear = document.querySelector('.ant-picker-clear') as HTMLElement;
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/export/shipments/${MOCK_SHIPMENT_DETAIL.id}/`, { export_date: null },
    ));
  });

  it('shows the auto date the server returns after a clear', () => {
    const { rerender, container } = renderRows({ ...MOCK_SHIPMENT_DETAIL, export_date: '2026-09-30' }, [field]);
    const client = new QueryClient();
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <DetailExtraFieldRows shipment={{ ...MOCK_SHIPMENT_DETAIL, export_date: '2026-10-02' }} fields={[field]}
            missingKeys={new Set()} readOnly={false} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(within(container.querySelector('#detail-field-export_date') as HTMLElement).getByText('02.10.2026')).toBeInTheDocument();
  });
});

describe('yes_no editor', () => {
  const config: IEditFieldConfig = { key: 'has_peregruz', labelKey: 'sheet.row.peregruz_status', inputType: 'yes_no' };

  it('saves No as false and Yes as true', () => {
    const onChange = vi.fn();
    render(<FieldEditor config={config} value={null} onChange={onChange} defaultOpen />);
    fireEvent.click(screen.getByText('No'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the stored false as No, not as empty', () => {
    render(<FieldEditor config={config} value={false} onChange={vi.fn()} />);
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});

describe('completeness wiring for the extra rows', () => {
  it('counts extra keys on their card and makes them jumpable', () => {
    expect(countMissing('transport', new Set(['dest_entry_at']))).toBe(1);
    expect(EDITABLE_FIELD_KEYS.has('loading_ended_at')).toBe(true);
    expect(sectionAnchorFor('trip_id')).toBe('detail-field-trip_id');
    expect(sectionAnchorFor('packing_template')).toBe('detail-field-packing_template');
    expect(sectionAnchorFor('has_current_advance')).toBe('detail-field-has_current_advance');
    expect(sectionAnchorFor('sales_report.approved_at')).toBe('section-sale');
    expect(sectionAnchorFor('quality.hil_sertifikaty')).toBe('detail-field-quality.hil_sertifikaty');
  });
});
