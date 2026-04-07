import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

// A component that throws on demand
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom');
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React's console.error for expected error boundary logs
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary panelName="Test">
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('shows fallback UI when a child throws', () => {
    render(
      <ErrorBoundary panelName="Chat">
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Chat/)).toBeInTheDocument();
    expect(screen.getByText(/encountered an error/)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('uses default label when panelName is omitted', () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This panel')).toBeInTheDocument();
  });

  it('recovers when "Try again" is clicked', () => {
    let shouldThrow = true;
    function Toggleable() {
      if (shouldThrow) throw new Error('transient');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary panelName="Test">
        <Toggleable />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Try again')).toBeInTheDocument();

    // Fix the issue, then click retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    const customFallback = (error: Error, reset: () => void) => (
      <div>
        <span>Custom: {error.message}</span>
        <button onClick={reset}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary panelName="Test" fallback={customFallback}>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom: boom')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('logs error to console with panel name', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary panelName="Metrics">
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      '[ErrorBoundary:Metrics]',
      expect.any(Error),
      expect.any(String),
    );
  });
});
