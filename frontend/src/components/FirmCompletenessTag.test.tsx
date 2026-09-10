import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { FirmCompletenessTag, FirmCompletenessAlert } from './FirmCompletenessTag';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('FirmCompletenessTag', () => {
  it('shows the green complete tag when nothing is missing', () => {
    render(<FirmCompletenessTag missing={[]} labelNamespace="firms_admin" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('renders the count, not a raw i18n key, when fields are missing', () => {
    render(<FirmCompletenessTag missing={['address_tk', 'director']} labelNamespace="firms_admin" />);
    // i18next is given `count` but the namespace has no plural forms — guard
    // against it falling through to `firm_completeness.missing_count`.
    const tag = screen.getByText('Missing 2');
    expect(tag).toBeInTheDocument();
  });

  it('opens the missing-field list on click, not only on hover', async () => {
    const user = userEvent.setup();
    render(<FirmCompletenessTag missing={['address_tk']} labelNamespace="firms_admin" />);
    await user.click(screen.getByText('Missing 1'));
    expect(await screen.findByText('Address (TK)')).toBeInTheDocument();
  });

  it('resolves labels from the import-firm namespace too', async () => {
    const user = userEvent.setup();
    render(<FirmCompletenessTag missing={['bank_details']} labelNamespace="import_firms_admin" />);
    await user.click(screen.getByText('Missing 1'));
    expect(await screen.findByText('Bank Details')).toBeInTheDocument();
  });
});

describe('FirmCompletenessAlert', () => {
  it('reports success when nothing is missing', () => {
    render(<FirmCompletenessAlert missing={[]} labelNamespace="firms_admin" />);
    expect(
      screen.getByText('All fields needed for contracts and invoices are filled.'),
    ).toBeInTheDocument();
  });

  it('lists every missing field by its translated label', () => {
    render(
      <FirmCompletenessAlert
        missing={['bank_details_tk', 'director']}
        labelNamespace="firms_admin"
      />,
    );
    expect(screen.getByText('2 field(s) still missing')).toBeInTheDocument();
    expect(screen.getByText('Bank Details (TK)')).toBeInTheDocument();
    expect(screen.getByText('Director')).toBeInTheDocument();
  });
});
