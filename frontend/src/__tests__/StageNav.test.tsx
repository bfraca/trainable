import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireClick } from '@testing-library/react';
import StageNav from '@/components/StageNav';

// fireClick isn't exported — use fireEvent
import { fireEvent } from '@testing-library/react';

describe('StageNav', () => {
  it('renders all three stages', () => {
    render(<StageNav state="created" onStartStage={vi.fn()} isRunning={false} />);

    expect(screen.getByText('EDA')).toBeInTheDocument();
    expect(screen.getByText('Prep')).toBeInTheDocument();
    expect(screen.getByText('Train')).toBeInTheDocument();
  });

  it('enables EDA button when state is "created"', () => {
    const onStart = vi.fn();
    render(<StageNav state="created" onStartStage={onStart} isRunning={false} />);

    const edaButton = screen.getByText('EDA').closest('button')!;
    expect(edaButton).not.toBeDisabled();

    fireEvent.click(edaButton);
    expect(onStart).toHaveBeenCalledWith('eda');
  });

  it('disables all buttons when isRunning is true', () => {
    render(<StageNav state="created" onStartStage={vi.fn()} isRunning={true} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('enables Prep only after EDA is done', () => {
    const onStart = vi.fn();
    render(<StageNav state="eda_done" onStartStage={onStart} isRunning={false} />);

    const prepButton = screen.getByText('Prep').closest('button')!;
    expect(prepButton).not.toBeDisabled();

    fireEvent.click(prepButton);
    expect(onStart).toHaveBeenCalledWith('prep');
  });

  it('disables Train when Prep is not done', () => {
    render(<StageNav state="eda_done" onStartStage={vi.fn()} isRunning={false} />);

    const trainButton = screen.getByText('Train').closest('button')!;
    expect(trainButton).toBeDisabled();
  });

  it('enables Train after Prep is done', () => {
    const onStart = vi.fn();
    render(<StageNav state="prep_done" onStartStage={onStart} isRunning={false} />);

    const trainButton = screen.getByText('Train').closest('button')!;
    expect(trainButton).not.toBeDisabled();

    fireEvent.click(trainButton);
    expect(onStart).toHaveBeenCalledWith('train');
  });

  it('disables EDA button when state is "failed" (shows failed status)', () => {
    render(<StageNav state="failed" onStartStage={vi.fn()} isRunning={false} />);

    const edaButton = screen.getByText('EDA').closest('button')!;
    // When state is 'failed', all stages show failed status — button is disabled
    expect(edaButton).toBeDisabled();
    expect(edaButton.className).toContain('red');
  });

  it('enables EDA button when state is "cancelled"', () => {
    const onStart = vi.fn();
    render(<StageNav state="cancelled" onStartStage={onStart} isRunning={false} />);

    const edaButton = screen.getByText('EDA').closest('button')!;
    expect(edaButton).not.toBeDisabled();
  });
});
