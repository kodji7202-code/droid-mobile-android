import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';
import hljs from 'highlight.js/lib/common';
import { BackIcon, CloseIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';
import type { WorkspaceFileContent } from '@droidmobile/daemon-client';
import { truncateToUtf8Bytes } from './utf8Truncate';

const ONE_MIB = 1048576;

interface FileViewerProps {
  sessionId: string;
  filePath: string;
  onBack: () => void;
}

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  lua: 'lua',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  diff: 'diff',
  patch: 'diff',
  ini: 'ini',
  r: 'r',
};

function getFileLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || ext === filePath.toLowerCase()) return null;
  return EXTENSION_MAP[ext] ?? null;
}

function highlightCode(
  code: string,
  language: string | null,
): { html: string; isHighlighted: boolean } {
  if (!language || code.length > 200_000) {
    return { html: '', isHighlighted: false };
  }
  try {
    if (hljs.getLanguage(language)) {
      const res = hljs.highlight(code, { language, ignoreIllegals: true });
      return { html: res.value, isHighlighted: true };
    }
  } catch {
    // fallback to unhighlighted plain text
  }
  return { html: '', isHighlighted: false };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isImageExtension(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return (
    ext === 'png' ||
    ext === 'jpg' ||
    ext === 'jpeg' ||
    ext === 'gif' ||
    ext === 'webp' ||
    ext === 'svg' ||
    ext === 'ico' ||
    ext === 'bmp' ||
    ext === 'avif' ||
    ext === 'tiff' ||
    ext === 'tif'
  );
}

function getImageMimeType(path: string, mime?: string): string {
  if (mime?.startsWith('image/')) return mime;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  return 'image/png';
}

export function FileViewer({ sessionId, filePath, onBack }: FileViewerProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const [data, setData] = useState<WorkspaceFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isImg = isImageExtension(filePath);

  const fetchContent = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const res = await connection.getFileContent({
        sessionId,
        filePath,
        encoding: isImg ? 'base64' : 'utf8',
      });
      startTransition(() => {
        setData(res);
        setLoading(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [connection, sessionId, filePath, isImg]);

  useEffect(() => {
    void fetchContent();
  }, [fetchContent]);

  const byteLength = data?.byteLength ?? 0;
  const capped = useMemo(() => truncateToUtf8Bytes(data?.content ?? '', ONE_MIB), [data?.content]);
  const isTruncated = byteLength > ONE_MIB || capped.truncated;
  const displayContent = capped.text;

  const language = useMemo(() => getFileLanguage(filePath), [filePath]);

  const highlightResult = useMemo(() => {
    return highlightCode(displayContent, language);
  }, [displayContent, language]);

  const lineCount = useMemo(() => {
    if (!displayContent) return 0;
    return displayContent.split(/\r?\n/).length;
  }, [displayContent]);

  return (
    <div className="file-viewer" data-testid="file-viewer">
      <header className="file-viewer__header">
        <button
          type="button"
          className="btn btn--icon file-viewer__back-btn"
          data-testid="file-viewer-back"
          aria-label={t('workspace.fileViewerBack')}
          onClick={onBack}
        >
          <BackIcon width={20} height={20} />
        </button>

        <div className="file-viewer__title-wrapper">
          <h3 className="file-viewer__path" data-testid="file-viewer-path">
            {filePath}
          </h3>
          {data ? (
            <span
              className="file-viewer__size"
              data-testid="file-viewer-size"
              title={`${byteLength} bytes`}
            >
              {formatBytes(byteLength)}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="btn btn--icon file-viewer__close-btn"
          data-testid="file-viewer-close-header"
          aria-label={t('workspace.fileViewerClose')}
          onClick={onBack}
        >
          <CloseIcon width={20} height={20} />
        </button>
      </header>

      <div className="file-viewer__body">
        {loading ? (
          <p className="file-viewer__loading" data-testid="file-viewer-loading">
            {t('workspace.fileViewerLoading')}
          </p>
        ) : error ? (
          <div className="file-viewer__error" data-testid="file-viewer-error">
            <p className="file-viewer__error-message">
              {t('workspace.fileViewerError')}: {error}
            </p>
            <div className="file-viewer__error-actions">
              <button
                type="button"
                className="btn btn--primary"
                data-testid="file-viewer-retry"
                onClick={() => void fetchContent()}
              >
                {t('workspace.fileViewerRetry')}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="file-viewer-close"
                onClick={onBack}
              >
                {t('workspace.fileViewerClose')}
              </button>
            </div>
          </div>
        ) : isImg || data?.mimeType?.startsWith('image/') ? (
          <div className="file-viewer__image-wrapper">
            <img
              src={`data:${getImageMimeType(filePath, data?.mimeType)};base64,${data?.content}`}
              alt={filePath}
              data-testid="file-viewer-image"
              className="file-viewer__image"
            />
          </div>
        ) : data?.isBinary ? (
          <div className="file-viewer__binary" data-testid="file-viewer-binary">
            <p>{t('workspace.fileViewerBinary', { bytes: byteLength })}</p>
          </div>
        ) : (
          <div className="file-viewer__text-wrapper">
            {isTruncated ? (
              <div className="file-viewer__truncation-notice" data-testid="file-viewer-truncation">
                {t('workspace.fileViewerTruncated', { total: formatBytes(byteLength) })}
              </div>
            ) : null}
            <div className="file-viewer__code-container">
              {lineCount > 0 ? (
                <div
                  className="file-viewer__line-numbers"
                  data-testid="file-viewer-line-numbers"
                  aria-hidden="true"
                >
                  {lineCount <= 2000 ? (
                    Array.from({ length: lineCount }, (_, i) => (
                      <div
                        key={i + 1}
                        className="file-viewer__line-number"
                        data-testid="file-viewer-line-number"
                      >
                        {i + 1}
                      </div>
                    ))
                  ) : (
                    <pre className="file-viewer__line-numbers-pre">
                      {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
                    </pre>
                  )}
                </div>
              ) : null}
              <pre className="file-viewer__code" data-testid="file-viewer-text">
                {highlightResult.isHighlighted ? (
                  <code
                    className={`hljs language-${language}`}
                    dangerouslySetInnerHTML={{ __html: highlightResult.html }}
                  />
                ) : (
                  <code>{displayContent}</code>
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
