import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SelfKanbanCard } from './SelfKanbanCard';
import type { ITaskListItem } from '@/types';

function card(exportCode: string | null) {
  const task = {
    id: 3, shipment: 7, shipment_code: '0210007/26', export_code: exportCode,
    title_key: 'tasks.print_cmr', state: 'open', assignee_role: 'document_team',
    is_overdue: false, deadline: null, step: 'gumruk_girish', phase: 'DOCS', kind: 'shipment',
  } as unknown as ITaskListItem;
  return <MemoryRouter><SelfKanbanCard task={task} /></MemoryRouter>;
}

describe('SelfKanbanCard export code', () => {
  it('shows the export code under the system code', () => {
    render(card('02|10|007|A|26|01'));
    expect(screen.getByText('0210007/26')).toBeInTheDocument();
    expect(screen.getByText('02|10|007|A|26|01')).toBeInTheDocument();
  });

  it('adds nothing when the export code is null or blank', () => {
    const { container, rerender } = render(card(null));
    const withNull = container.textContent;
    rerender(card('  '));
    expect(container.textContent).toBe(withNull);
    expect(screen.getByText('0210007/26')).toBeInTheDocument();
  });
});
