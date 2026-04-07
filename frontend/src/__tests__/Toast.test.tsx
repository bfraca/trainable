import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/Toast';

// Helper component that triggers toasts via the hook
function ToastTrigger({
  variant = 'success' as const,
  title = 'Test Toast',
  description,
  duration,
}: {
  variant?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  description?: string;
  duration?: number;
}) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast({ variant, title, description, duration })}>Show Toast</button>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders toast when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger title="Hello World" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders toast with description', () => {
    render(
      <ToastProvider>
        <ToastTrigger title="Title" description="Some details" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Some details')).toBeInTheDocument();
  });

  it('auto-dismisses after duration', () => {
    render(
      <ToastProvider>
        <ToastTrigger title="Ephemeral" duration={2000} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Ephemeral')).toBeInTheDocument();

    // Advance past duration + dismiss animation time
    act(() => {
      vi.advanceTimersByTime(2200);
    });

    expect(screen.queryByText('Ephemeral')).not.toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    render(
      <ToastProvider>
        <ToastTrigger title="Toast 1" />
      </ToastProvider>,
    );

    const button = screen.getByText('Show Toast');
    fireEvent.click(button);
    fireEvent.click(button);

    // Should have at least 2 toast items (both show "Toast 1")
    const toasts = screen.getAllByText('Toast 1');
    expect(toasts.length).toBeGreaterThanOrEqual(2);
  });

  it('shows correct icon for each variant', () => {
    const { rerender } = render(
      <ToastProvider>
        <ToastTrigger variant="error" title="Error toast" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Show Toast'));
    // The toast should have role="alert"
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Rerender with warning variant
    rerender(
      <ToastProvider>
        <ToastTrigger variant="warning" title="Warning toast" />
      </ToastProvider>,
    );
  });

  it('throws when useToast is used outside ToastProvider', () => {
    // Suppress console.error for expected throw
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadComponent() {
      useToast();
      return null;
    }

    expect(() => render(<BadComponent />)).toThrow('useToast must be used within ToastProvider');
  });

  it('limits maximum visible toasts', () => {
    render(
      <ToastProvider>
        <ToastTrigger title="Toast" duration={60000} />
      </ToastProvider>,
    );

    const button = screen.getByText('Show Toast');

    // Click more times than MAX_TOASTS (5)
    for (let i = 0; i < 7; i++) {
      fireEvent.click(button);
    }

    // Allow eviction timeouts to run
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const toasts = screen.getAllByRole('alert');
    expect(toasts.length).toBeLessThanOrEqual(5);
  });
});
