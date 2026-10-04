/**
 * Message paging over the SDK facade's getMessages, which accepts a `cursor`
 * but returns only the message array. Verified against daemon 0.232.0: the
 * daemon's cursor equals the oldest message id of the returned page, so the
 * next cursor is derivable from the page content.
 */
import type { SessionMessage } from '@factory/droid-sdk';

export interface SessionMessagesPage {
  messages: SessionMessage[];
  /** True when the page was full and an older page may exist. */
  hasMore: boolean;
  /** Oldest message id of the page; pass as `cursor` for the next (older) page. */
  nextCursor?: string;
}

export function toPage(messages: SessionMessage[], requestedLimit: number): SessionMessagesPage {
  const nextCursor = messages.length > 0 ? messageIdOf(messages[messages.length - 1]) : undefined;
  return {
    messages,
    hasMore: messages.length === requestedLimit && nextCursor !== undefined,
    nextCursor,
  };
}

function messageIdOf(message: SessionMessage): string | undefined {
  const id = (message as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}
