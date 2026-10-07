import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNotification } from '../platform/appNotifications';
import type { PendingInteraction } from '../stores/interactions';
import { NotificationCoordinator } from './notificationCoordinator';
import type { NotificationSnapshot } from './notificationCoordinator';

const texts: Record<string, string> = {
  'session.title': 'Session',
  'notifications.local.requestTitle': 'Approval needed',
  'notifications.local.requestText': '{{session}}: {{detail}}',
  'notifications.local.requestFallback': 'Waiting in {{session}}',
  'notifications.local.askTitle': 'Question',
  'notifications.local.askText': 'Answer needed in {{session}}',
  'notifications.local.approve': 'Approve',
  'notifications.local.turnTitle': 'Turn finished',
  'notifications.local.turnText': 'Finished in {{session}}',
};
const translate = (key: string, options: Record<string, string> = {}) =>
  (texts[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => options[name] ?? '');

const permission = (id: string, sessionId: string, command = 'touch hello.txt') =>
  ({
    kind: 'permission',
    id,
    sessionId,
    request: {
      toolUses: [
        {
          toolUse: { id: `tool-${id}`, name: 'Execute', input: { command } },
          details: { type: 'exec', command, fullCommand: command },
        },
      ],
      options: [],
    },
    settle: () => undefined,
    twins: [],
  }) as unknown as PendingInteraction;

const view = (turnActive: boolean, extra: object = {}) => ({
  turnActive,
  stopRequested: false,
  interrupted: false,
  cwd: 'C:\\work\\demo',
  ...extra,
});

const base: NotificationSnapshot = {
  enabled: true,
  approvals: true,
  turns: true,
  appActive: false,
  viewedSessionId: null,
  pending: [],
  views: {},
};

function setup() {
  const post = vi.fn(async (_notification: LocalNotification) => true);
  const cancel = vi.fn(async (_tag: string) => undefined);
  const coordinator = new NotificationCoordinator({ post, cancel }, () => translate);
  return {
    post,
    cancel,
    update: (patch: Partial<NotificationSnapshot>) => coordinator.update({ ...base, ...patch }),
  };
}

describe('NotificationCoordinator', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('posts one approvals notification per session while the app is in the background', () => {
    const pending = [permission('p1', 's1')];
    ctx.update({ pending, views: { s1: view(true) } });
    ctx.update({ pending, views: { s1: view(true) } });
    expect(ctx.post).toHaveBeenCalledTimes(1);
    expect(ctx.post).toHaveBeenCalledWith({
      tag: 'approvals:s1',
      channel: 'approvals',
      title: 'Approval needed',
      text: 'demo: touch hello.txt',
      sessionId: 's1',
      approveRequestId: 'p1',
      approveLabel: 'Approve',
    });
  });

  it('removes the notification once the request is answered', () => {
    const pending = [permission('p1', 's1')];
    ctx.update({ pending, views: { s1: view(true) } });
    ctx.update({ pending: [], views: { s1: view(true) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:s1');
  });

  it('stays silent for the session on screen and notifies for another one', () => {
    ctx.update({
      appActive: true,
      viewedSessionId: 'a',
      pending: [permission('p1', 'a'), permission('p2', 'b')],
      views: { a: view(true), b: view(true) },
    });
    expect(ctx.post).toHaveBeenCalledTimes(1);
    expect(ctx.post.mock.calls[0]?.[0].sessionId).toBe('b');
  });

  it('withdraws a request notification when its session comes on screen', () => {
    const pending = [permission('p1', 'b')];
    ctx.update({ appActive: true, viewedSessionId: 'a', pending, views: { b: view(true) } });
    ctx.update({ appActive: true, viewedSessionId: 'b', pending, views: { b: view(true) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:b');
  });

  it('notifies for a request that was already pending when the app went to the background', () => {
    const pending = [permission('p1', 'a')];
    ctx.update({ appActive: true, viewedSessionId: 'a', pending, views: { a: view(true) } });
    expect(ctx.post).not.toHaveBeenCalled();
    ctx.update({ appActive: false, viewedSessionId: 'a', pending, views: { a: view(true) } });
    expect(ctx.post).toHaveBeenCalledTimes(1);
  });

  it('posts nothing while the master switch or the approvals channel is off', () => {
    const pending = [permission('p1', 's1')];
    ctx.update({ enabled: false, pending, views: { s1: view(true) } });
    ctx.update({ approvals: false, pending, views: { s1: view(true) } });
    expect(ctx.post).not.toHaveBeenCalled();
  });

  it('cancels posted requests when the user switches the channel off', () => {
    const pending = [permission('p1', 's1')];
    ctx.update({ pending, views: { s1: view(true) } });
    ctx.update({ approvals: false, pending, views: { s1: view(true) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:s1');
  });

  it('offers Approve only for plain tool permissions', () => {
    const plan = permission('p1', 's1');
    if (plan.kind === 'permission') {
      (plan.request.toolUses[0] as { details: { type: string } }).details.type = 'exit_spec_mode';
    }
    ctx.update({ pending: [plan], views: { s1: view(true) } });
    const posted = ctx.post.mock.calls[0]?.[0];
    expect(posted).toBeDefined();
    expect(posted).not.toHaveProperty('approveRequestId');
  });

  it('posts a turns notification when a turn finishes in the background', () => {
    ctx.update({ views: { s1: view(true) } });
    expect(ctx.post).not.toHaveBeenCalled();
    ctx.update({ views: { s1: view(false) } });
    expect(ctx.post).toHaveBeenCalledWith({
      tag: 'turn:s1',
      channel: 'turns',
      title: 'Turn finished',
      text: 'Finished in demo',
      sessionId: 's1',
    });
  });

  it('does not repeat the turn notification on later updates and clears it when the session is viewed', () => {
    ctx.update({ views: { s1: view(true) } });
    ctx.update({ views: { s1: view(false) } });
    ctx.update({ views: { s1: view(false) } });
    expect(ctx.post).toHaveBeenCalledTimes(1);
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
    expect(ctx.cancel).toHaveBeenCalledWith('turn:s1');
  });

  it('skips turns finished on screen, stopped by the user, interrupted or switched off', () => {
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(true) } });
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
    ctx.update({ views: { s2: view(true) } });
    ctx.update({ views: { s2: view(false, { stopRequested: true }) } });
    ctx.update({ views: { s3: view(true) } });
    ctx.update({ views: { s3: view(false, { interrupted: true }) } });
    ctx.update({ turns: false, views: { s4: view(true) } });
    ctx.update({ turns: false, views: { s4: view(false) } });
    expect(ctx.post).not.toHaveBeenCalled();
  });

  it('shares the pushed approvals tag so a later push replaces it instead of duplicating it', () => {
    const both = [permission('p1', 's1'), permission('p2', 's1')];
    ctx.update({ pending: both, views: { s1: view(true) } });
    expect(ctx.post).toHaveBeenCalledTimes(1);
    expect(ctx.post.mock.calls[0]?.[0].tag).toBe('approvals:s1');
  });

  it('shows the next request of a session under the same tag once the first is answered', () => {
    const both = [permission('p1', 's1'), permission('p2', 's1')];
    ctx.update({ pending: both, views: { s1: view(true) } });
    ctx.update({ pending: [both[1]!], views: { s1: view(true) } });
    expect(ctx.cancel).not.toHaveBeenCalled();
    expect(ctx.post).toHaveBeenCalledTimes(2);
    expect(ctx.post.mock.calls[1]?.[0]).toMatchObject({
      tag: 'approvals:s1',
      approveRequestId: 'p2',
    });
    ctx.update({ pending: [], views: { s1: view(true) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:s1');
  });

  it('posts a request again after the master switch comes back on', () => {
    const pending = [permission('p1', 's1')];
    ctx.update({ pending, views: { s1: view(true) } });
    ctx.update({ enabled: false, pending, views: { s1: view(true) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:s1');
    ctx.update({ pending, views: { s1: view(true) } });
    expect(ctx.post).toHaveBeenCalledTimes(2);
  });

  describe('when Android refuses a post', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('does not remember a refused request alert as delivered', async () => {
      const pending = [permission('p1', 's1')];
      ctx.post.mockResolvedValueOnce(false);
      ctx.update({ pending, views: { s1: view(true) } });
      await flush();
      ctx.update({ pending, views: { s1: view(true) } });
      expect(ctx.post).toHaveBeenCalledTimes(1);
      ctx.update({ appActive: true, viewedSessionId: 'other', pending, views: { s1: view(true) } });
      expect(ctx.post).toHaveBeenCalledTimes(2);
      await flush();
      ctx.update({ appActive: true, viewedSessionId: 'other', pending, views: { s1: view(true) } });
      expect(ctx.post).toHaveBeenCalledTimes(2);
    });

    it('retries a refused request alert when the switches change', async () => {
      const pending = [permission('p1', 's1')];
      ctx.post.mockResolvedValueOnce(false);
      ctx.update({ turns: false, pending, views: { s1: view(true) } });
      await flush();
      ctx.update({ turns: true, pending, views: { s1: view(true) } });
      expect(ctx.post).toHaveBeenCalledTimes(2);
    });

    it('keeps a refused finished-turn alert and delivers it when conditions change', async () => {
      ctx.post.mockResolvedValueOnce(false);
      ctx.update({ views: { s1: view(true) } });
      ctx.update({ views: { s1: view(false) } });
      await flush();
      ctx.update({ views: { s1: view(false) } });
      expect(ctx.post).toHaveBeenCalledTimes(1);
      ctx.update({ appActive: true, viewedSessionId: 'x', views: { s1: view(false) } });
      expect(ctx.post).toHaveBeenCalledTimes(2);
    });

    it('drops a refused finished-turn alert once the user has seen the session', async () => {
      ctx.post.mockResolvedValueOnce(false);
      ctx.update({ views: { s1: view(true) } });
      ctx.update({ views: { s1: view(false) } });
      await flush();
      ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
      ctx.update({ appActive: true, viewedSessionId: 'x', views: { s1: view(false) } });
      expect(ctx.post).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the pushed notifications of the session that comes on screen, once', () => {
    ctx.update({ views: { s1: view(false) } });
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
    expect(ctx.cancel).toHaveBeenCalledWith('approvals:s1');
    expect(ctx.cancel).toHaveBeenCalledWith('turn:s1');
    ctx.cancel.mockClear();
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
    expect(ctx.cancel).not.toHaveBeenCalled();
    ctx.update({ appActive: false, viewedSessionId: 's1', views: { s1: view(false) } });
    ctx.update({ appActive: true, viewedSessionId: 's1', views: { s1: view(false) } });
    expect(ctx.cancel).toHaveBeenCalledWith('turn:s1');
  });

  it('uses the AskUser texts for a question', () => {
    const ask = {
      kind: 'askuser',
      id: 'a1',
      sessionId: 's1',
      request: { toolCallId: 'x' },
      settle: () => undefined,
      twins: [],
    } as unknown as PendingInteraction;
    ctx.update({ pending: [ask], views: { s1: view(true) } });
    const posted = ctx.post.mock.calls[0]?.[0];
    expect(posted?.title).toBe('Question');
    expect(posted?.text).toBe('Answer needed in demo');
    expect(posted).not.toHaveProperty('approveRequestId');
  });
});
