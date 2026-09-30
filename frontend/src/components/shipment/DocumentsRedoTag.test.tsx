import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { DocumentsRedoTag } from './DocumentsRedoTag';
import { SheetColumnHeader } from '@/components/sheet/SheetColumnHeader';
import { SelfKanbanCard } from '@/components/kanban/SelfKanbanCard';
import { DraftCard } from '@/pages/export/DraftPool';
import type { IShipmentDraft, ITaskListItem } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: 'document_team' } }) }));
vi.mock('@/hooks/useShipments', () => ({
  useSetColumnColor: () => ({ mutate: vi.fn() }),
  useSoftDeleteShipment: () => ({ mutateAsync: vi.fn() }),
}));

const MARK = 'Truck changed — redo the documents';
const RESET_AT = '2026-09-30T08:00:00Z';

describe('truck-change rollback mark (2026-09-30)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('the tag shows only for a rolled-back shipment', () => {
    const { rerender } = render(<DocumentsRedoTag resetAt={RESET_AT} />);
    expect(screen.getByText(MARK)).toBeInTheDocument();
    rerender(<DocumentsRedoTag resetAt={null} />);
    expect(screen.queryByText(MARK)).toBeNull();
  });

  it('the Sheet column header carries it', () => {
    render(
      <SheetColumnHeader shipmentId={1} seqNumber={1} exportCode="SH-1" officialExportCode={null}
        columnColor={null} documentsResetAt={RESET_AT} />,
    );
    expect(screen.getByText('Truck changed')).toBeInTheDocument();
  });

  it('a reopened task on My tasks says it is a redo', () => {
    const task = {
      id: 3, shipment: 7, shipment_code: 'SH-7', title_key: 'tasks.print_cmr', state: 'open',
      assignee_role: 'document_team', is_overdue: false, deadline: null, documents_redo: true,
      step: 'gumruk_girish', phase: 'DOCS', kind: 'shipment',
    } as unknown as ITaskListItem;
    render(<MemoryRouter><SelfKanbanCard task={task} /></MemoryRouter>);
    expect(screen.getByText('Again: truck changed')).toBeInTheDocument();
  });

  it('the Preparation card carries it', () => {
    const draft = {
      id: 9, shipment_code: 'SH-9', export_code: null, block_sources: [], freshness: 'today',
      harvest_age_days: 0, documents_reset_at: RESET_AT,
    } as unknown as IShipmentDraft;
    render(<MemoryRouter><DraftCard draft={draft} /></MemoryRouter>);
    expect(screen.getByText(MARK)).toBeInTheDocument();
  });
});
