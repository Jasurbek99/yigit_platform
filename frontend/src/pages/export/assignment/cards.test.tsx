import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import type { IShipmentDraft } from '@/types';
import { SupplyCard } from './SupplyCard';
import { ExportPartCard } from './ExportPartCard';

vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ru' } }),
}));

function row(over: Partial<IShipmentDraft> = {}): IShipmentDraft {
  return {
    id: 1, shipment_code: '2109001/26', date: '2026-09-29', created_at: '2026-09-29T06:00:00Z',
    created_by_name: null, weight_net: 15000, block_sources: [], export_code: null,
    previous_platform_id: null, harvest_age_days: 0, freshness: 'today', variety_confidence: 'none',
    status_code: 'draft', ...over,
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('Assignment board cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: { results: [
      { id: 1, category: 'harvest_status', code: 'fresh', label_tk: 'Täze', label_ru: 'Свежий',
        label_en: 'Fresh', icon: null, sort_order: 1, is_active: true },
    ] } });
  });

  it('the packing card shows its export code', () => {
    wrap(<SupplyCard draft={row({ export_code: 'EXP-77' })} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('EXP-77')).toBeInTheDocument();
  });

  it('the export card shows its export code even with no packing joined', () => {
    wrap(<ExportPartCard part={row({ export_code: 'EXP-77', status_code: 'gumruk_girish' })}
      selected={false} onSelect={() => {}} />);
    expect(screen.getByText('EXP-77')).toBeInTheDocument();
  });

  it('shows filled details with their labels and hides empty ones', async () => {
    wrap(<SupplyCard draft={row({ harvest_status: 'fresh', variety_name: 'Pink' })}
      selected={false} onSelect={() => {}} />);
    expect(screen.getByText('Pink')).toBeInTheDocument();
    expect(screen.getByText('assign.detail.variety:')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Свежий')).toBeInTheDocument());
    expect(screen.queryByText('assign.detail.border_point:')).toBeNull();
  });
});
