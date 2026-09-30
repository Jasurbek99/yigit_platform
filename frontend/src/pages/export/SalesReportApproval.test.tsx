import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { ISalesReport } from '@/types';
import { SalesReportApproval } from './SalesReportApproval';

const mutate = vi.fn();
vi.mock('@/hooks/useSalesReport', () => ({
  useApproveSalesReport: () => ({ mutate, isPending: false }),
}));

process.env.TZ = 'UTC';

const report = (over: Partial<ISalesReport> = {}) =>
  ({ approved_at: null, approved_by_name: null, ...over }) as ISalesReport;

describe('SalesReportApproval', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('an export manager approves an unapproved report', async () => {
    render(<SalesReportApproval shipmentId="12" report={report()} role="export_manager" isSuperuser={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve report' }));
    expect(mutate).toHaveBeenCalled();
  });

  it('a sales rep sees no button', () => {
    render(<SalesReportApproval shipmentId="12" report={report()} role="sales_rep" isSuperuser={false} />);
    expect(screen.queryByRole('button', { name: 'Approve report' })).toBeNull();
  });

  it('an approved report shows who approved it and when, in TM time', () => {
    render(
      <SalesReportApproval
        shipmentId="12"
        report={report({ approved_at: '2026-10-05T09:30:00+05:00', approved_by_name: 'aganazar' })}
        role="export_manager"
        isSuperuser={false}
      />,
    );
    expect(screen.getByText('Approved: aganazar, 05.10 09:30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve report' })).toBeNull();
  });

  it('no report yet — nothing to approve', () => {
    const { container } = render(
      <SalesReportApproval shipmentId="12" report={null} role="export_manager" isSuperuser={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
