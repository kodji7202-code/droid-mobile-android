import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { Transcript } from './Transcript';

const ITEMS: TranscriptItem[] = [
  { kind: 'user', id: 'u1', text: '/val-hello is running', delivery: 'sent' },
  {
    kind: 'user',
    id: 'n1',
    text: 'Reply with the single word OK.',
    delivery: 'sent',
    notice: true,
  },
  { kind: 'assistant', id: 'a1', text: 'OK', streaming: false },
];

describe('expanded command prompt', () => {
  it('shows the notice as its own labelled entry without shifting bubble numbers', () => {
    render(
      <AppProviders>
        <Transcript items={ITEMS} onRetry={() => undefined} />
      </AppProviders>,
    );
    expect(screen.getByTestId('msg-user-0')).toHaveTextContent('/val-hello is running');
    const notice = screen.getByTestId('msg-notice-0');
    expect(notice).toHaveTextContent('Reply with the single word OK.');
    expect(notice).toHaveTextContent('Command prompt');
    expect(screen.queryByTestId('msg-user-1')).toBeNull();
    expect(screen.getByTestId('msg-assistant-1')).toHaveTextContent('OK');
  });
});
