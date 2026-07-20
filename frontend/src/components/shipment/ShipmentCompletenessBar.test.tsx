import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentCompletenessBar } from './ShipmentCompletenessBar';
import type { ICompleteness } from '@/types';

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
});
