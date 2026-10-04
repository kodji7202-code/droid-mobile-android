import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Sheet } from './Sheet';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';
import { ToastProvider, useToast } from './Toast';
import { AppProviders } from '../test/render-app';

/** Opens a sheet from a button so the component can be re-rendered open/closed. */
function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="open-sheet" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Sample sheet">
        <p>Sheet body</p>
      </Sheet>
    </div>
  );
}

describe('Sheet', () => {
  it('renders the dialog with an accessible title when open', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <SheetHarness />
      </AppProviders>,
    );
    expect(screen.queryByRole('dialog', { name: 'Sample sheet' })).not.toBeInTheDocument();
    await user.click(screen.getByTestId('open-sheet'));
    expect(screen.getByRole('dialog', { name: 'Sample sheet' })).toBeInTheDocument();
    expect(screen.getByText('Sheet body')).toBeInTheDocument();
  });

  it('closes on Escape and via the close button', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <SheetHarness />
      </AppProviders>,
    );
    await user.click(screen.getByTestId('open-sheet'));
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByTestId('open-sheet'));
    await user.click(screen.getByTestId('sheet-close'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes when the backdrop is clicked but not when clicking inside', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <SheetHarness />
      </AppProviders>,
    );
    await user.click(screen.getByTestId('open-sheet'));
    await user.click(screen.getByText('Sheet body'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('sheet-backdrop'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('ConfirmDialog', () => {
  it('reports confirm and cancel choices through its test-id buttons', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete item"
        message="This cannot be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} title="X" message="Y" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });
});

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a message and dismisses it automatically', async () => {
    vi.useFakeTimers();
    function ToastHarness() {
      const { showToast } = useToast();
      return <button type="button" data-testid="show" onClick={() => showToast('Saved')} />;
    }
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('show'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });
});

describe('EmptyState / ErrorState / Skeleton', () => {
  it('renders title, message and action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No sessions"
        message="Create one to start."
        action={
          <button type="button" onClick={onAction}>
            Create
          </button>
        }
      />,
    );
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No sessions');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders an error with a working retry control', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Failed"
        message="Daemon unreachable."
        onRetry={onRetry}
        retryLabel="Retry now"
      />,
    );
    expect(screen.getByTestId('error-state')).toHaveTextContent('Daemon unreachable.');
    await user.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders skeleton placeholder lines', () => {
    render(<Skeleton lines={4} />);
    expect(screen.getByTestId('skeleton').children).toHaveLength(4);
  });
});
