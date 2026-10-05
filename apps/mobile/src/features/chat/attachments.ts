import type { UserAttachment } from '@droidmobile/daemon-client';

export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;

/** Types the picker offers; the daemon accepts exactly these image formats. */
export const ATTACH_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json,.log';

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'log']);
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

export type AttachmentRejection =
  | { reason: 'type'; name: string; type: string }
  | { reason: 'size'; name: string; limitMb: number }
  | { reason: 'count'; name: string; limit: number }
  | { reason: 'read'; name: string };

export type AttachmentKind = 'image' | 'pdf' | 'text';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Decides what a picked file is from its MIME type, falling back to the extension. */
export function classifyFile(
  file: Pick<File, 'name' | 'type'>,
): { kind: AttachmentKind; mediaType: string } | undefined {
  const extension = extensionOf(file.name);
  const mime = file.type.toLowerCase();
  const image = Object.values(IMAGE_TYPES).includes(mime) ? mime : IMAGE_TYPES[extension];
  if (image && (mime === '' || mime.startsWith('image/'))) {
    return { kind: 'image', mediaType: image };
  }
  if (mime === 'application/pdf' || (mime === '' && extension === 'pdf')) {
    return { kind: 'pdf', mediaType: 'application/pdf' };
  }
  if (TEXT_MIME.has(mime) || (mime === '' && TEXT_EXTENSIONS.has(extension))) {
    return { kind: 'text', mediaType: 'text/plain' };
  }
  return undefined;
}

const LIMITS: Readonly<Record<AttachmentKind, number>> = {
  image: MAX_IMAGE_BYTES,
  pdf: MAX_PDF_BYTES,
  text: MAX_TEXT_BYTES,
};

function readFile(file: File, as: 'dataUrl' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/**
 * The daemon (0.232.0) compresses every image for the model and only handles PNG
 * and JPEG: GIF and WebP fail the turn with error_during_execution. They are
 * re-encoded as PNG (first frame for animations) before they are attached.
 */
export async function convertToPng(dataUrl: string): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image decode failed'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

const NEEDS_PNG = new Set(['image/gif', 'image/webp']);

/** Validates and reads one picked file; rejections happen before anything is sent. */
export async function readAttachment(
  file: File,
  alreadyAttached: number,
  toPng: (dataUrl: string) => Promise<string> = convertToPng,
): Promise<{ attachment: UserAttachment } | { rejection: AttachmentRejection }> {
  const found = classifyFile(file);
  if (!found) {
    const type = file.type !== '' ? file.type : extensionOf(file.name) || 'unknown';
    return { rejection: { reason: 'type', name: file.name, type } };
  }
  if (alreadyAttached >= MAX_ATTACHMENTS) {
    return { rejection: { reason: 'count', name: file.name, limit: MAX_ATTACHMENTS } };
  }
  const limit = LIMITS[found.kind];
  if (file.size > limit) {
    return {
      rejection: { reason: 'size', name: file.name, limitMb: Math.round(limit / (1024 * 1024)) },
    };
  }
  try {
    if (found.kind === 'text') {
      const data = await readFile(file, 'text');
      return { attachment: { kind: 'file', name: file.name, mediaType: found.mediaType, data } };
    }
    const url = await readFile(file, 'dataUrl');
    if (found.kind === 'image' && NEEDS_PNG.has(found.mediaType)) {
      const png = await toPng(url);
      return {
        attachment: {
          kind: 'image',
          mediaType: 'image/png',
          data: png.slice(png.indexOf(',') + 1),
        },
      };
    }
    const data = url.slice(url.indexOf(',') + 1);
    return found.kind === 'image'
      ? { attachment: { kind: 'image', mediaType: found.mediaType, data } }
      : { attachment: { kind: 'file', name: file.name, mediaType: found.mediaType, data } };
  } catch {
    return { rejection: { reason: 'read', name: file.name } };
  }
}

export interface AttachmentStreamOptions {
  images?: {
    type: 'base64';
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  }[];
  files?: (
    | { type: 'base64'; data: string; mediaType: 'application/pdf'; name: string }
    | { type: 'text'; data: string; mediaType: 'text/plain'; name: string }
  )[];
}

/** Maps attachments to the daemon's stream options (base64 images, PDF and text documents). */
export function toStreamOptions(attachments: readonly UserAttachment[]): AttachmentStreamOptions {
  const images: NonNullable<AttachmentStreamOptions['images']> = [];
  const files: NonNullable<AttachmentStreamOptions['files']> = [];
  for (const item of attachments) {
    if (item.kind === 'image') {
      images.push({
        type: 'base64',
        data: item.data,
        mediaType: item.mediaType as 'image/png',
      });
    } else if (item.mediaType === 'application/pdf') {
      files.push({
        type: 'base64',
        data: item.data,
        mediaType: 'application/pdf',
        name: item.name,
      });
    } else {
      files.push({ type: 'text', data: item.data, mediaType: 'text/plain', name: item.name });
    }
  }
  return {
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}
