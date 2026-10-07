import rateLimit from '@fastify/rate-limit';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
} from 'fastify';
import type { Writable } from 'node:stream';
import type { BridgeConfig } from './config.js';
import { maskToken } from './mask.js';
import { dispatchEvent } from './notify.js';
import { mapHookEvent } from './payload.js';
import type { PairingVerifier } from './secret.js';
import type { Sender } from './sender.js';
import type { DeviceStore } from './store.js';
import {
  isValidDeviceId,
  validateDevice,
  validateHookEvent,
  type FieldError,
} from './validation.js';

export interface AppDeps {
  config: Pick<
    BridgeConfig,
    'dryRun' | 'rateLimitMax' | 'rateLimitWindowMs' | 'bodyLimitBytes' | 'trustProxy' | 'logLevel'
  >;
  store: DeviceStore;
  verifier: PairingVerifier;
  sender: Sender;
  /** Defaults to stdout; tests pass their own stream to inspect the log. */
  logStream?: Writable;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
  }
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  fields?: FieldError[],
) {
  return reply.code(statusCode).send({ error: { code, message, ...(fields ? { fields } : {}) } });
}

function invalid(reply: FastifyReply, errors: FieldError[]) {
  const names = errors.map((e) => e.field).join(', ');
  return sendError(reply, 400, 'invalid_request', `Invalid request: ${names}`, errors);
}

const BEARER = /^Bearer[ \t]+(\S+)$/i;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, verifier, sender } = deps;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustProxy,
  });

  // Own the body parsing so a malformed body of any content type is a plain 400 whose
  // message never quotes the payload (it may hold a token).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (request, body, done) => {
    // An unmatched route is a 404 whatever the body holds.
    if (request.is404) return done(null, undefined);
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      return done(null, JSON.parse(text));
    } catch {
      return done(new HttpError(400, 'invalid_json', 'Request body is not valid JSON'));
    }
  });

  // Not `global`: the plugin's per-route hooks run after app-level hooks, so a request
  // would be authenticated before it was counted and wrong secrets would never be limited.
  await app.register(rateLimit, {
    global: false,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    errorResponseBuilder: (_request, context) =>
      new HttpError(
        429,
        'rate_limited',
        `Too many requests, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
      ),
  });
  const limiter = app.rateLimit();
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/healthz') return;
    await limiter.call(app, request, reply);
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.statusCode, error.code, error.message, error.fields);
    }
    if (error.statusCode === 413) {
      return sendError(reply, 413, 'payload_too_large', 'Request body is too large');
    }
    if (error.statusCode === 429) {
      return sendError(reply, 429, 'rate_limited', 'Too many requests');
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return sendError(reply, error.statusCode, 'bad_request', 'Bad request');
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, 500, 'internal_error', 'Internal server error');
  });

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, 'not_found', 'Route not found'),
  );

  app.addHook('onResponse', async (request, reply) => {
    const route = request.url.split('?')[0];
    request.log[route === '/healthz' ? 'debug' : 'info'](
      {
        method: request.method,
        path: route,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Authentication is a hook of the encapsulated /v1 context rather than a check on the raw
  // URL: the router matches percent-decoded paths (`/%76%31/devices` is `/v1/devices`), so
  // only the matched route can say whether a request reaches a protected handler.
  await app.register(
    async (v1) => {
      v1.addHook('onRequest', async (request, reply) => {
        const match = BEARER.exec(request.headers.authorization ?? '');
        const verified = match?.[1] !== undefined && (await verifier.verify(match[1]));
        if (verified) return;
        request.log.warn(
          { reason: match ? 'invalid_secret' : 'missing_secret' },
          'authentication failed',
        );
        return reply
          .header('www-authenticate', 'Bearer')
          .code(401)
          .send({ error: { code: 'unauthorized', message: 'Missing or invalid credentials' } });
      });
      v1.setNotFoundHandler((_request, reply) =>
        sendError(reply, 404, 'not_found', 'Route not found'),
      );
      v1.post('/devices', async (request, reply) => {
        const result = validateDevice(request.body);
        if (!result.ok) return invalid(reply, result.errors);
        const { created } = await store.upsert(result.value);
        request.log.info(
          {
            deviceId: result.value.deviceId,
            token: maskToken(result.value.fcmToken),
            created,
          },
          'device registered',
        );
        return reply
          .code(created ? 201 : 200)
          .send({ deviceId: result.value.deviceId, label: result.value.label, created });
      });

      v1.delete<{ Params: { id: string } }>('/devices/:id', async (request, reply) => {
        const { id } = request.params;
        const removed = isValidDeviceId(id) && (await store.remove(id));
        if (!removed) return sendError(reply, 404, 'not_found', 'Unknown device');
        request.log.info({ deviceId: id }, 'device removed');
        return reply.code(204).send();
      });

      v1.post('/events', async (request, reply) => {
        const result = validateHookEvent(request.body);
        if (!result.ok) return invalid(reply, result.errors);
        const { hookEventName, notificationType, sessionId } = result.value;
        const kind = mapHookEvent(hookEventName, notificationType);
        const summary = {
          hookEventName,
          notificationType: notificationType?.slice(0, 64),
          sessionId,
        };
        if (kind === null) {
          request.log.info(summary, 'hook event ignored');
          return { sent: 0, failed: 0, removed: 0, dryRun: config.dryRun };
        }
        request.log.info({ ...summary, kind, devices: store.size }, 'hook event received');
        const outcome = await dispatchEvent(
          { store, sender, log: request.log },
          { kind, sessionId },
        );
        request.log.info(
          { kind, sessionId, ...outcome, dryRun: config.dryRun },
          config.dryRun ? 'dry-run: no FCM call was made' : 'hook event delivered',
        );
        return { ...outcome, dryRun: config.dryRun };
      });
    },
    { prefix: '/v1' },
  );

  return app;
}
