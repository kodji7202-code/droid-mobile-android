export interface FieldError {
  field: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_TOKEN_LENGTH = 4096;
const MAX_LABEL_LENGTH = 64;
const MAX_SESSION_ID_LENGTH = 256;

export const DEVICE_ID_RULE = 'must match ^[A-Za-z0-9._-]{1,64}$';

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export interface DeviceInput {
  deviceId: string;
  fcmToken: string;
  label: string;
}

export function validateDevice(body: unknown): Validated<DeviceInput> {
  const input = asObject(body);
  if (!input) {
    return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  }
  const errors: FieldError[] = [];
  const { deviceId, fcmToken, label } = input;

  if (deviceId === undefined) errors.push({ field: 'deviceId', message: 'is required' });
  else if (typeof deviceId !== 'string') {
    errors.push({ field: 'deviceId', message: 'must be a string' });
  } else if (!isValidDeviceId(deviceId))
    errors.push({ field: 'deviceId', message: DEVICE_ID_RULE });

  if (fcmToken === undefined) errors.push({ field: 'fcmToken', message: 'is required' });
  else if (typeof fcmToken !== 'string') {
    errors.push({ field: 'fcmToken', message: 'must be a string' });
  } else if (fcmToken.trim() === '')
    errors.push({ field: 'fcmToken', message: 'must not be empty' });
  else if (fcmToken.length > MAX_TOKEN_LENGTH) {
    errors.push({ field: 'fcmToken', message: `must be at most ${MAX_TOKEN_LENGTH} characters` });
  }

  if (label !== undefined) {
    if (typeof label !== 'string') errors.push({ field: 'label', message: 'must be a string' });
    else if (label.length > MAX_LABEL_LENGTH) {
      errors.push({ field: 'label', message: `must be at most ${MAX_LABEL_LENGTH} characters` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      deviceId: deviceId as string,
      fcmToken: fcmToken as string,
      label: typeof label === 'string' ? label : '',
    },
  };
}

export interface HookEventInput {
  sessionId: string;
  hookEventName: 'Notification' | 'Stop';
  notificationType: string | undefined;
}

export function validateHookEvent(body: unknown): Validated<HookEventInput> {
  const input = asObject(body);
  if (!input) {
    return { ok: false, errors: [{ field: 'body', message: 'must be a JSON object' }] };
  }
  const errors: FieldError[] = [];
  const sessionId = input.session_id;
  const hookEventName = input.hook_event_name;
  const notificationType = input.notification_type;

  if (sessionId === undefined) errors.push({ field: 'session_id', message: 'is required' });
  else if (typeof sessionId !== 'string' || sessionId === '') {
    errors.push({ field: 'session_id', message: 'must be a non-empty string' });
  } else if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    errors.push({
      field: 'session_id',
      message: `must be at most ${MAX_SESSION_ID_LENGTH} characters`,
    });
  }

  if (hookEventName === undefined) {
    errors.push({ field: 'hook_event_name', message: 'is required' });
  } else if (hookEventName !== 'Notification' && hookEventName !== 'Stop') {
    errors.push({ field: 'hook_event_name', message: 'must be Notification or Stop' });
  }

  if (hookEventName === 'Notification') {
    if (typeof notificationType !== 'string' || notificationType === '') {
      errors.push({
        field: 'notification_type',
        message: 'is required for Notification events and must be a non-empty string',
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      sessionId: sessionId as string,
      hookEventName: hookEventName as 'Notification' | 'Stop',
      notificationType: typeof notificationType === 'string' ? notificationType : undefined,
    },
  };
}
