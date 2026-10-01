import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import type { IShipmentDetail, ITaskListItem } from '@/types';

// Print tasks now carry the document dialogs (useShipmentDocumentPacket).
vi.mock('@/hooks/useDocumentPackets', () => ({
  useShipmentDocumentPacket: () => ({ data: null, isLoading: false }),
}));
vi.mock('@/hooks/useTaskActions', () => ({
  useStartTask: vi.fn(),
  useCompleteTask: vi.fn(),
}));

const approve = vi.fn();
vi.mock('@/hooks/useSalesReport', () => ({
  useApproveSalesReport: () => ({ mutate: approve, isPending: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'export_manager', is_superuser: false } }),
}));

const complete = vi.fn();

function docsTask(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
  return {
    id: 21, shipment: 7, shipment_code: '0000007/26', kind: 'shipment', link: '',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: null, truck_plate: null, scope_date: null, step: 'gumruk_girish', phase: 'DOCS',
    title_key: 'tasks.print_cmr', assignee_role: 'document_team', assignee_user: null,
    assignee_user_name: null, target_fields_list: [], completion_rule: 'confirm',
    deadline: null, deadline_rule: '', state: 'open', is_overdue: false,
    created_at: '2026-09-30T08:00:00Z', started_at: null, completed_at: null, blocked_reason: '',
    cancelled_reason: '',
    ...overrides,
  } as ITaskListItem;
}

function renderPanel(task: ITaskListItem) {
  return render(
    <MemoryRouter>
      <SelfBoardActiveTaskPanel
        task={task}
        shipment={{ id: 7, block_sources: [] } as unknown as IShipmentDetail}
        onComplete={vi.fn()}
        sheetItem={null}
        rows={[]}
        rowSettings={{}}
        isSheetLoading={false}
      />
    </MemoryRouter>,
  );
}

describe('SelfBoardActiveTaskPanel — PREP/DOCS chain (2026-09-30)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => {
    vi.mocked(useStartTask).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useStartTask>);
    vi.mocked(useCompleteTask).mockReturnValue(
      { mutate: complete, isPending: false } as unknown as ReturnType<typeof useCompleteTask>,
    );
  });

  it('a confirm task shows its own button and completes', async () => {
    renderPanel(docsTask());
    await userEvent.click(screen.getByRole('button', { name: 'Printed' }));
    expect(complete).toHaveBeenCalled();
  });

  it('the new target fields have a label in every language', () => {
    for (const lng of ['en', 'ru', 'tk']) {
      for (const key of ['trip_id', 'truck_head_id', 'packing_template', 'advance_links', 'has_current_advance', 'customs_exit_at', 'loading_ended_at', 'sales_report', 'customs_entry_at',
        // «Quality inspection» targets — the card showed the raw keys (E2E 2026-10-01)
        'transit_days', 'transport_temp_c', 'shelf_life_days']) {
        expect(i18n.getFixedT(lng)(`tasks.field_label.${key}`, { defaultValue: '' })).not.toBe('');
      }
    }
  });

  it('every role has a task-card owner label in every language (E2E 2026-10-01)', () => {
    const roles = Object.keys(i18n.getResourceBundle('en', 'translation').roles as Record<string, string>);
    for (const lng of ['en', 'ru', 'tk']) {
      for (const role of roles) {
        expect(i18n.getFixedT(lng)(`tasks.role.${role}`, { defaultValue: '' }), `${lng} ${role}`).not.toBe('');
      }
    }
  });

  it('the LOAD task «Ýükleme gutardy» has a title in every language', () => {
    for (const lng of ['en', 'ru', 'tk']) {
      expect(i18n.getFixedT(lng)('tasks.loading_ended', { defaultValue: '' })).not.toBe('');
    }
  });

  it('destination customs is worded as one moment — customs done (item 30)', () => {
    const en = i18n.getFixedT('en');
    const ru = i18n.getFixedT('ru');
    expect(en('shipment_edit_drawer.field.customs_entry_at')).toBe('Dest. customs done');
    expect(ru('shipment_edit_drawer.field.customs_entry_at')).toBe('Таможня пройдена');
    expect(ru('tasks.trigger_dest_customs')).toBe('Отметить, когда таможня назначения пройдена');
  });

  it('«Maşyn saýla» links to the Truck Board', () => {
    renderPanel(docsTask({
      title_key: 'tasks.choose_truck', completion_rule: 'all_fields_filled',
      target_fields_list: ['trip_id'], step: 'draft', assignee_role: 'export_manager',
    }));
    expect(screen.getByRole('link', { name: 'Truck Board' })).toHaveAttribute('href', '/export/truck-board');
  });

  it('«Give the advance» links to the Advances page (E2E 2026-10-01)', () => {
    renderPanel(docsTask({
      title_key: 'tasks.give_advance', completion_rule: 'all_fields_filled',
      target_fields_list: ['has_current_advance'], assignee_role: 'finansist',
    }));
    expect(screen.getByRole('link', { name: 'Advances' })).toHaveAttribute('href', '/export/advances?shipment=7');
  });

  it('«Approve the report» approves right on the card (E2E 2026-10-01)', async () => {
    render(
      <MemoryRouter>
        <SelfBoardActiveTaskPanel
          task={docsTask({
            title_key: 'tasks.approve_sales_report', completion_rule: 'all_fields_filled',
            target_fields_list: ['sales_report.approved_at'], step: 'satyldy', assignee_role: 'export_manager',
          })}
          shipment={{ id: 7, block_sources: [], sales_report: { approved_at: null } } as unknown as IShipmentDetail}
          onComplete={vi.fn()}
          sheetItem={null}
          rows={[]}
          rowSettings={{}}
          isSheetLoading={false}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve report' }));
    expect(approve).toHaveBeenCalled();
  });

  it('join_supply links to the Assignment board', () => {
    renderPanel(docsTask({
      title_key: 'tasks.join_supply', completion_rule: 'any_field_filled',
      target_fields_list: ['block_sources'], step: 'draft', assignee_role: 'export_manager',
    }));
    expect(screen.getByRole('link', { name: /Assignment board/ })).toHaveAttribute('href', '/export/assign');
  });
});
