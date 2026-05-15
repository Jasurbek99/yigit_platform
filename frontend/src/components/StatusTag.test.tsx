import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
  it('renders the status text verbatim', () => {
    render(<StatusTag statusDisplay="Loading" />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('renders unknown status with default styling rather than crashing', () => {
    render(<StatusTag statusDisplay="Something-New" />);
    expect(screen.getByText('Something-New')).toBeInTheDocument();
  });

  it('renders Cyrillic / Turkmen status text', () => {
    render(<StatusTag statusDisplay="Ýoldaky" />);
    expect(screen.getByText('Ýoldaky')).toBeInTheDocument();
  });
});
