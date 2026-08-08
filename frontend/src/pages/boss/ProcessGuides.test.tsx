import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { ProcessGuides } from './ProcessGuides';

describe('ProcessGuides', () => {
  beforeAll(async () => {
    // Pin language to English so assertions are stable regardless of what
    // the language-detector picks up from happy-dom's navigator/cookie state.
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('opens the shipment journey doc with the correct slug when its tile is clicked', async () => {
    const user = userEvent.setup();
    render(<ProcessGuides />);
    await user.click(screen.getByRole('button', { name: /A shipment's journey/ }));
    expect(window.open).toHaveBeenCalledWith(
      '/api/v1/export/boss/process-doc/?doc=shipment-process-boss',
      '_blank',
      expect.stringContaining('noopener'),
    );
  });

  it('opens the BPMN doc with the correct slug when its tile is clicked', async () => {
    const user = userEvent.setup();
    render(<ProcessGuides />);
    await user.click(screen.getByRole('button', { name: /BPMN diagram/ }));
    expect(window.open).toHaveBeenCalledWith(
      '/api/v1/export/boss/process-doc/?doc=shipment-bpmn',
      '_blank',
      expect.stringContaining('noopener'),
    );
  });

  it('renders both tiles with their translated names', () => {
    render(<ProcessGuides />);
    expect(screen.getByText("A shipment's journey")).toBeInTheDocument();
    expect(screen.getByText('BPMN diagram')).toBeInTheDocument();
  });
});
