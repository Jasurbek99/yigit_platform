import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import { ShipmentSaleSection } from './ShipmentSaleSection';

vi.mock('@/pages/export/ShipmentDetailHelpers', () => ({ SalesReportForm: () => <div>sales-report-form</div> }));
vi.mock('@/components/shipment/ShipmentFieldGroup', () => ({ ShipmentFieldGroup: () => null }));
vi.mock('@/components/shipment/DetailExtraFieldRows', () => ({ DetailExtraFieldRows: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

// The report form (lines + expenses) is the longest block on the page, so it
// starts folded and opens on a click.
describe('ShipmentSaleSection', () => {
  it('keeps the sales report folded until it is opened', () => {
    render(
      <ShipmentSaleSection
        shipment={{ ...MOCK_SHIPMENT_DETAIL, status_step: MIN_SALES_REPORT_STEP }}
        missingKeys={new Set()}
        readOnly={false}
        canEditSalesReport
      />,
    );
    expect(screen.queryByText('sales-report-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(i18n.t('sales_report.page_title')));
    expect(screen.getByText('sales-report-form')).toBeInTheDocument();
  });
});
