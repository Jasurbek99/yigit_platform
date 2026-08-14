import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/i18n';
import type { ISupplyDraftPayload } from '@/types';
import { SupplyDraftModal } from './SupplyDraftModal';

// Real mutations pass the created record (which has shipment_code) to the
// per-call onSuccess — the mock must do the same, or the toast-interpolation
// bug (literal "{{code}}" shown to the user) can't be caught by a test.
const FAKE_DRAFT = { shipment_code: '0101001/26' };
const mutate = vi.fn((_payload: ISupplyDraftPayload, opts?: { onSuccess?: (draft: typeof FAKE_DRAFT) => void }) => {
  opts?.onSuccess?.(FAKE_DRAFT);
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useAdmin', () => ({
  useGreenhouseBlocks: () => ({
    data: [{ id: 7, code: 'A', name: 'A', is_active: true }],
    isLoading: false,
  }),
  useTomatoVarieties: () => ({
    data: [{ id: 3, code: '08', name: 'Redity', is_experimental: false }],
    isLoading: false,
  }),
  useShipmentOptions: () => ({
    data: [{ id: 1, category: 'harvest_status', code: 'fresh', label_tk: 'Täze', label_en: 'Fresh', label_ru: 'Свежий', icon: null, sort_order: 1, is_active: true }],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useDrafts', () => ({
  useCreateSupplyDraft: () => ({ mutate, isPending: false }),
}));

/**
 * antd mocks every Form.Item control to the same id="test-id" under jsdom
 * (see BlockSelect's `id` collision), so getByLabelText can't disambiguate
 * fields with a Select inside. Walk from the label text to its Form.Item
 * and query the control directly instead.
 */
function fieldControl(labelText: string): HTMLElement {
  const item = screen.getByText(labelText).closest('.ant-form-item');
  if (!item) throw new Error(`No .ant-form-item ancestor for label "${labelText}"`);
  const control = item.querySelector('input, textarea');
  if (!control) throw new Error(`No input/textarea inside the "${labelText}" field`);
  return control as HTMLElement;
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplyDraftModal open onClose={() => {}} onSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

describe('SupplyDraftModal', () => {
  beforeEach(async () => {
    mutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    await i18n.changeLanguage('en');
  });

  const submitBtn = () => screen.getByRole('button', { name: 'Create Supply Draft' });

  it('blocks submit with no blocks, then submits weight_net + block_ids once a block and weight are set', async () => {
    wrap();

    // 1) Submit immediately — no blocks, no weight — validation must block it.
    await userEvent.click(submitBtn());
    expect(mutate).not.toHaveBeenCalled();

    // 2) Enter weight, but STILL no blocks — isolates the blocks-required
    // rule specifically (without this step, step 1's failure could be coming
    // from the weight rule alone and the blocks rule could be silently gone).
    const weightField = fieldControl('Total Weight (kg)');
    await userEvent.clear(weightField);
    await userEvent.type(weightField, '22000');
    await userEvent.click(submitBtn());
    expect(mutate).not.toHaveBeenCalled();

    // 3) Pick a block — now both rules are satisfied, submit goes through.
    await userEvent.click(fieldControl('Blocks'));
    await userEvent.click(await screen.findByText('A'));
    await userEvent.click(submitBtn());

    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0][0];
    expect(payload.block_ids).toEqual([7]);
    expect(typeof payload.weight_net).toBe('number');
    expect(payload.weight_net).toBe(22000);
    // Variety/harvest_status/export_code/notes were never touched — must be omitted, not sent as null.
    expect(payload).not.toHaveProperty('varieties');
  });

  it('maps a picked variety to varieties: [id]', async () => {
    wrap();

    await userEvent.click(fieldControl('Blocks'));
    await userEvent.click(await screen.findByText('A'));
    const weightField = fieldControl('Total Weight (kg)');
    await userEvent.clear(weightField);
    await userEvent.type(weightField, '22000');

    // VarietySelect renders the option label as "08 · Redity", where "08" is
    // its own <span> (the code) — click that instead of 'Redity', which sits
    // in the label's outer span and isn't its own matchable text node.
    await userEvent.click(fieldControl('Variety'));
    await userEvent.click(await screen.findByText('08'));

    await userEvent.click(submitBtn());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0].varieties).toEqual([3]);
  });

  it('shows the success toast with the real shipment_code, not the literal {{code}} token', async () => {
    wrap();

    await userEvent.click(fieldControl('Blocks'));
    await userEvent.click(await screen.findByText('A'));
    const weightField = fieldControl('Total Weight (kg)');
    await userEvent.clear(weightField);
    await userEvent.type(weightField, '22000');
    await userEvent.click(submitBtn());

    expect(toast.success).toHaveBeenCalledTimes(1);
    const toastMessage = vi.mocked(toast.success).mock.calls[0][0];
    expect(toastMessage).toContain('0101001/26');
    expect(toastMessage).not.toContain('{{code}}');
  });

  it('blocks submit when weight is exactly zero, even with a block already selected', async () => {
    wrap();

    await userEvent.click(fieldControl('Blocks'));
    await userEvent.click(await screen.findByText('A'));

    const weightField = fieldControl('Total Weight (kg)');
    await userEvent.clear(weightField);
    await userEvent.type(weightField, '0');
    await userEvent.click(submitBtn());
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.clear(weightField);
    await userEvent.type(weightField, '22000');
    await userEvent.click(submitBtn());
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
