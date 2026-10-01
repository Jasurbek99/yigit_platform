import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { ITaskListItem } from '@/types';
import { PlanTaskCard } from './PlanTaskCard';

// Viewers on KZ/RU domain machines often run UTC; deadlines must still read in
// greenhouse time (Asia/Ashgabat), so the test runs the browser clock in UTC.
process.env.TZ = 'UTC';

function task(over: Partial<ITaskListItem>): ITaskListItem {
  return {
    id: 1, kind: 'daily_export', shipment: null, shipment_code: '', step: 'daily_export',
    phase: 'PLAN', title_key: 'tasks.daily_export_plan', assignee_role: 'export_manager',
    assignee_user: null, assignee_user_name: null, target_fields_list: [],
    completion_rule: 'manual_done', deadline: '2026-09-28T23:59:59+05:00', deadline_rule: '',
    state: 'open', is_overdue: false, created_at: '2026-09-28T06:05:00+05:00',
    started_at: null, completed_at: null, blocked_reason: '', link: '/export/drafts',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: null, truck_plate: null,
    scope_date: '2026-09-28', cancelled_reason: '',
    ...over,
  };
}

function renderCard(t: ITaskListItem) {
  return render(<MemoryRouter><PlanTaskCard task={t} /></MemoryRouter>);
}

describe('PlanTaskCard', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows the due time and the day of a daily task', () => {
    renderCard(task({}));
    expect(screen.getByText('Due: 28.09 23:59')).toBeInTheDocument();
    expect(screen.getByText('28.09')).toBeInTheDocument();
  });

  it('marks an overdue task red', () => {
    renderCard(task({ is_overdue: true }));
    expect(screen.getByRole('button').style.borderLeft).toMatch(/rgb\(255, 77, 79\)|#ff4d4f/);
  });

  it('labels a missed daily task', () => {
    renderCard(task({ state: 'cancelled', cancelled_reason: 'missed' }));
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });

  const day = {
    date: '2026-09-28', day_of_week: 1,
    rows: [
      { key: 'country:3', label: 'Russia', country_id: 3, is_gapy: false, plan: 4, fact: 3 },
      { key: 'gapy', label: 'Gapy Satys', country_id: null, is_gapy: true, plan: 1, fact: 1 },
    ],
    plan_total: 5, export_parts: 4, export_parts_packed: 3, packed: 3, loading_target: 6,
  };

  it('shows plan vs fact per row and the packing count on an export task', () => {
    renderCard(task({ progress: day }));
    expect(screen.getByText('Russia 3/4 · Gapy Satys 1/1 · packing 3/4')).toBeInTheDocument();
  });

  it('shows packed of target on a loading task', () => {
    renderCard(task({ kind: 'daily_loading', title_key: 'tasks.daily_loading_plan', progress: day }));
    expect(screen.getByText('Packed 3 of 6')).toBeInTheDocument();
  });

  it('shows no progress line on a done task', () => {
    renderCard(task({ state: 'done', progress: day }));
    expect(screen.queryByTestId('plan-task-progress')).not.toBeInTheDocument();
  });

  it('tells a late weekly-plan manager they can still fill until Sunday', () => {
    renderCard(task({
      kind: 'weekly_plan', title_key: 'tasks.fill_weekly_plan', is_overdue: true, scope_date: null,
    }));
    expect(screen.getByText(/until Sunday/)).toBeInTheDocument();
  });
});
