import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { DetailFieldRow } from './DetailFieldRow';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';

// api.patch is never actually exercised by these tests (no save is ever
// flushed to completion), but useShipmentPatchMulti wires up a real Axios
// instance on render, so it must exist as a mock or the import chain throws.
vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

const TEXT_CONFIG: IEditFieldConfig = {
  key: 'truck_plate',
  labelKey: 'shipment_edit_drawer.field.truck_plate',
  inputType: 'text',
};

const BOOLEAN_CONFIG: IEditFieldConfig = {
  key: 'is_gapy_satys',
  labelKey: 'shipment_edit_drawer.field.is_gapy_satys',
  inputType: 'boolean',
};

const COUNTRY_CONFIG: IEditFieldConfig = {
  key: 'country',
  labelKey: 'shipment_edit_drawer.field.country',
  inputType: 'select',
  optionsSource: 'countries',
};

function renderRow(props: { config: IEditFieldConfig; readOnly?: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DetailFieldRow shipment={MOCK_SHIPMENT_DETAIL} config={props.config} readOnly={props.readOnly} />
    </QueryClientProvider>,
  );
}

describe('DetailFieldRow', () => {
  beforeAll(async () => {
    // Pin language so label/value text assertions are stable regardless of
    // what the language-detector picks up from happy-dom's navigator/cookie
    // state (same reasoning as LoginPage.test.tsx).
    await i18n.changeLanguage('en');
  });

  // ── Finding 1 regression guard ────────────────────────────────────────────
  //
  // enterEdit() swaps the plain-text value for FieldEditor with autoFocus in
  // the same tick. The row's onBlur fires on that swap (the outgoing Text
  // node loses focus as it's unmounted) and — per the bug report — the event
  // can carry `relatedTarget: null` even though focus is actually landing on
  // the incoming input, still inside the row. A synchronous check of
  // `relatedTarget` would misread that as "focus left the row" and revert
  // the edit it just opened.
  //
  // happy-dom (this project's test environment, see vitest.config.ts) does
  // not automatically fire a blur/focusout event when a focused node is
  // detached from the DOM the way some real browsers do — so we can't rely
  // on the click alone to reproduce the null-relatedTarget event. Instead we
  // reproduce the documented failure mode directly and deterministically:
  // once the editor is open and its input genuinely has focus, dispatch the
  // exact spurious event the bug report describes (blur on the row wrapper,
  // relatedTarget: null) and assert the row does not close. This exercises
  // the real handleBlur code path (queueMicrotask + document.activeElement
  // check) rather than asserting something jsdom/happy-dom would pass
  // vacuously regardless of the fix.
  it('does not close the editor on a same-tick blur whose relatedTarget is null while focus is still inside the row', async () => {
    const user = userEvent.setup();
    renderRow({ config: TEXT_CONFIG });

    const value = screen.getByText('01ABC123');
    await user.click(value);

    const input = await screen.findByRole('textbox');
    expect(input).toHaveFocus();

    // The spurious same-tick event from the Finding 1 report: relatedTarget
    // is null, but focus (document.activeElement) never actually left the
    // row — the input is still focused.
    act(() => {
      fireEvent.blur(input.closest('[id^="detail-field-"]') as HTMLElement, {
        relatedTarget: null,
      });
    });

    // handleBlur defers its decision to a microtask; give it a tick, then
    // assert the editor is STILL mounted (this is what the buggy synchronous
    // version got wrong — it would have called setIsEditing(false) here).
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
    expect(screen.queryByText('01ABC123')).not.toBeInTheDocument();
  });

  // Exit path sanity check: a genuine focus move OUT of the row must still
  // close the editor. This guards against "fixing" Finding 1 by simply never
  // closing on blur.
  it('closes the editor when focus genuinely moves outside the row', async () => {
    const user = userEvent.setup();
    renderRow({ config: TEXT_CONFIG });

    const value = screen.getByText('01ABC123');
    await user.click(value);
    const input = await screen.findByRole('textbox');
    expect(input).toHaveFocus();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const row = input.closest('[id^="detail-field-"]') as HTMLElement;
    act(() => {
      // Moving focus to `outside` triggers antd Input's own native blur
      // handling (its focus-visual state), so it must be inside the same
      // act() batch as the row's blur dispatch, not just the dispatch alone.
      outside.focus();
      fireEvent.blur(row, { relatedTarget: outside });
    });

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
    expect(screen.getByText('01ABC123')).toBeInTheDocument();
    document.body.removeChild(outside);
  });

  it('clicking a text row value enters edit mode', async () => {
    const user = userEvent.setup();
    renderRow({ config: TEXT_CONFIG });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByText('01ABC123'));
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
  });

  // ── Finding 2: readOnly rows never enter edit mode ────────────────────────
  it('does not enter edit mode on click when readOnly', async () => {
    const user = userEvent.setup();
    renderRow({ config: TEXT_CONFIG, readOnly: true });

    const value = screen.getByText('01ABC123');
    await user.click(value);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not enter edit mode on focus when readOnly', () => {
    renderRow({ config: TEXT_CONFIG, readOnly: true });

    const value = screen.getByText('01ABC123');
    // readOnly rows render the value with tabIndex={-1} — not part of the tab
    // order — but the row's onFocus handler is what actually gates entry
    // (enterEdit() early-returns when !canEdit). Firing focus directly
    // exercises that guard regardless of tab-order.
    fireEvent.focus(value);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // ── boolean rows never enter a separate edit state ────────────────────────
  //
  // Note on scope: this test verifies `showEditor = canEdit && (isEditing ||
  // isBoolean)` renders the Switch immediately with no plain-text
  // click-to-edit affordance. It does NOT independently verify the
  // `autoFocus={!isBoolean}` value DetailFieldRow passes to FieldEditor
  // (Finding 2's actual fix) — FieldEditor's own boolean branch already
  // refuses to forward autoFocus regardless of what it's given (see
  // FieldEditor.tsx), so a render-time assertion here can't distinguish the
  // call site being fixed from it being reverted; only source inspection /
  // the call site's TypeScript can. Capturing the literal prop would require
  // mocking FieldEditor at the module level, which would undercut the first
  // two tests' use of the real FieldEditor/antd Input for authentic focus
  // behaviour — not done here for that reason.
  it('renders a boolean row as a Switch with no click-to-edit text affordance', () => {
    renderRow({ config: BOOLEAN_CONFIG });

    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // ── Bug: read mode showed the raw FK id instead of its display name ──────
  it('renders the FK display name in read mode, not the raw id', () => {
    renderRow({ config: COUNTRY_CONFIG });

    // MOCK_SHIPMENT_DETAIL.country === 1, country_name === 'Kazakhstan'.
    expect(screen.getByText('Kazakhstan')).toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
