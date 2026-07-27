import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ShipmentCompletenessBar } from './ShipmentCompletenessBar';
import { ShipmentSaleSection } from './ShipmentSaleSection';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { ICompleteness } from '@/types';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

// jsdom has no layout engine, so scrollIntoView isn't implemented — stub it
// so section chips (firm_splits/sales_report/block_sources) don't throw.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const EMPTY_COMPLETENESS: ICompleteness = {
  required_total: 0,
  filled_count: 0,
  missing_fields: [],
  manual_tasks: [],
};

describe('ShipmentCompletenessBar', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  // required_total === 0 with no manual_tasks means the shipment owes
  // nothing right now — the spec requires no bar/card to render at all,
  // not an empty or 100% one.
  it('renders nothing when required_total is 0 and there are no manual tasks', () => {
    const { container } = render(
      <ShipmentCompletenessBar completeness={EMPTY_COMPLETENESS} onJumpToField={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // required_total is cumulative across every step a shipment has passed
  // (backend/apps/export/services/completeness.py) and never resets to
  // zero once the shipment has advanced. A shipment that has fully caught
  // up (filled_count === required_total) still has required_total > 0, so
  // gating on required_total === 0 would keep rendering a stale 100% bar
  // forever. The gate must be on what's actually outstanding.
  it('renders nothing when everything owed has been filled, even though required_total > 0', () => {
    const completeness: ICompleteness = {
      required_total: 3,
      filled_count: 3,
      missing_fields: [],
      manual_tasks: [],
    };
    const { container } = render(
      <ShipmentCompletenessBar completeness={completeness} onJumpToField={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // required_total === 0 but filled_count / required_total would divide by
  // zero — the component must short-circuit to 100% instead of NaN, and
  // still render because a manual task is present.
  it('shows 100% instead of NaN when required_total is 0 but a manual task keeps the bar visible', () => {
    const completeness: ICompleteness = {
      ...EMPTY_COMPLETENESS,
      manual_tasks: [{ id: 1, title_key: 'tasks.give_documents', role: 'transport', is_overdue: false }],
    };
    render(<ShipmentCompletenessBar completeness={completeness} onJumpToField={vi.fn()} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  // Field keys with a shipment_edit_drawer.field entry (most draft-step
  // target_fields, e.g. 'country') must render that label, not the raw key.
  it('renders the shipment_edit_drawer.field label for a covered missing_field key', () => {
    const completeness: ICompleteness = {
      required_total: 1,
      filled_count: 0,
      missing_fields: [{ key: 'country', title_key: 'tasks.set_destination', step: 'draft', role: 'export_manager' }],
      manual_tasks: [],
    };
    render(<ShipmentCompletenessBar completeness={completeness} onJumpToField={vi.fn()} />);
    expect(screen.getByText('Country')).toBeInTheDocument();
    expect(screen.queryByText('country')).not.toBeInTheDocument();
  });

  // As of Task 6b, every current TaskRule.target_fields key has a
  // shipment_edit_drawer.field translation, so this uses a synthetic key
  // that deliberately has no entry — it must still fall back to the raw
  // key via i18next's defaultValue rather than rendering a dotted i18n key
  // string in front of the user. This guards the fallback mechanism itself
  // for whatever field TaskRule grows next, decoupled from the live key set.
  it('falls back to the raw field key for a missing_field with no shipment_edit_drawer.field translation', () => {
    const completeness: ICompleteness = {
      required_total: 1,
      filled_count: 0,
      missing_fields: [{ key: 'unmapped_future_field', title_key: 'tasks.trigger_unmapped_future_field', step: 'gumruk_girish', role: 'document_team' }],
      manual_tasks: [],
    };
    render(<ShipmentCompletenessBar completeness={completeness} onJumpToField={vi.fn()} />);
    expect(screen.getByText('unmapped_future_field')).toBeInTheDocument();
  });

  // Task 13: two-tier split. 'weight_net' has an EDIT_FIELD_GROUPS entry
  // (goods group) so it must stay an actionable, clickable amber chip under
  // the existing "Missing:" label.
  it('renders an editable key as an actionable chip that calls onJumpToField', () => {
    const onJumpToField = vi.fn();
    const completeness: ICompleteness = {
      required_total: 1,
      filled_count: 0,
      missing_fields: [{ key: 'weight_net', title_key: 'tasks.set_weight', step: 'yuklenme', role: 'warehouse_chief' }],
      manual_tasks: [],
    };
    render(<ShipmentCompletenessBar completeness={completeness} onJumpToField={onJumpToField} />);

    const chip = screen.getByText('Net weight');
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(onJumpToField).toHaveBeenCalledWith('weight_net');
  });

  // 'departed_at' is an AD-1 timestamp written only by transition_to() — it
  // has no EDIT_FIELD_GROUPS entry and no section anchor, so it must render
  // under the informational label, muted, and must NOT call onJumpToField
  // (there is no #detail-field-departed_at row to jump to).
  it('renders a non-editable AD-1 key as a muted, non-clickable informational chip', () => {
    const onJumpToField = vi.fn();
    const completeness: ICompleteness = {
      required_total: 1,
      filled_count: 0,
      missing_fields: [{ key: 'departed_at', title_key: 'tasks.depart', step: 'yola_chykdy', role: 'transport' }],
      manual_tasks: [],
    };
    render(<ShipmentCompletenessBar completeness={completeness} onJumpToField={onJumpToField} />);

    expect(screen.getByText('Filled elsewhere or by the system:')).toBeInTheDocument();
    const chip = screen.getByText('Departed');
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(onJumpToField).not.toHaveBeenCalled();
  });

  // 'firm_splits' has no editable row either, but it maps to the Sale
  // section anchor — its chip is informational (muted) yet still clickable,
  // scrolling to #section-sale instead of opening a field editor. Renders
  // the REAL ShipmentSaleSection alongside the bar (not a fabricated stand-in
  // div) so this proves the id="section-sale" anchor actually reaches the
  // DOM through antd's Card — not just that the click handler fires.
  it('renders a section-mapped informational key as clickable, scrolling to the real Sale section anchor', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onJumpToField = vi.fn();
    const completeness: ICompleteness = {
      required_total: 1,
      filled_count: 0,
      missing_fields: [{ key: 'firm_splits', title_key: 'tasks.set_firm_splits', step: 'satys', role: 'export_manager' }],
      manual_tasks: [],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <ShipmentSaleSection
          shipment={MOCK_SHIPMENT_DETAIL}
          missingKeys={new Set()}
          readOnly
          canEditSalesReport={false}
        />
        <ShipmentCompletenessBar completeness={completeness} onJumpToField={onJumpToField} />
      </QueryClientProvider>,
    );

    const sectionEl = document.getElementById('section-sale');
    expect(sectionEl).not.toBeNull();
    const scrollSpy = vi.spyOn(sectionEl as HTMLElement, 'scrollIntoView');

    // "Export Firm Splits" also labels the firm-split table's own section
    // title inside ShipmentSaleSection — disambiguate to the completeness
    // bar's chip (an ant-tag), not that heading.
    const chip = screen
      .getAllByText('Export Firm Splits')
      .find((el) => el.closest('.ant-tag'));
    expect(chip).toBeDefined();
    fireEvent.click(chip as HTMLElement);

    expect(scrollSpy).toHaveBeenCalled();
    expect(onJumpToField).not.toHaveBeenCalled();
  });
});
