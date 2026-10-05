import { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';
import type { WorkspaceFileContent } from '@droidmobile/daemon-client';

const ONE_MIB = 1048576;

interface FileViewerProps {
  sessionId: string;
  filePath: string;
  onBack: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isImageExtension(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg';
}

function getImageMimeType(path: string, mime?: string): string {
  if (mime?.startsWith('image/')) return mime;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
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
  const isTruncated = byteLength > ONE_MIB;
  const displayContent = isTruncated && data?.content ? data.content.slice(0, ONE_MIB) : data?.content ?? '';

  return (
    <div className="file-viewer" data-testid="file-viewer" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="file-viewer__header" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border, #eee)', gap: '12px' }}>
        <button
          type="button"
          className="btn btn--icon file-viewer__back-btn"
          data-testid="file-viewer-back"
          aria-label={t('workspace.fileViewerBack')}
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <BackIcon width={20} height={20} />
        </button>

        <div className="file-viewer__title-wrapper" style={{ flex: 1, minWidth: 0 }}>
          <h3
            className="file-viewer__path"
            data-testid="file-viewer-path"
            style={{ margin: 0, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {filePath}
          </h3>
          {data ? (
            <span
              className="file-viewer__size"
              data-testid="file-viewer-size"
              style={{ fontSize: '0.8rem', opacity: 0.6 }}
            >
              {formatBytes(byteLength)}
            </span>
          ) : null}
        </div>
      </header>

      <div className="file-viewer__body" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading ? (
          <p className="file-viewer__loading" data-testid="file-viewer-loading">
            {t('workspace.fileViewerLoading')}
          </p>
        ) : error ? (
          <div className="file-viewer__error" data-testid="file-viewer-error">
            <p className="file-viewer__error-message">
              {t('workspace.fileViewerError')}: {error}
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
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
          <div className="file-viewer__image-wrapper" style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={`data:${getImageMimeType(filePath, data?.mimeType)};base64,${data?.content}`}
              alt={filePath}
              data-testid="file-viewer-image"
              style={{ maxWidth: '100%', height: 'auto', objectFit: 'contain' }}
            />
          </div>
        ) : data?.isBinary ? (
          <div className="file-viewer__binary" data-testid="file-viewer-binary">
            <p>{t('workspace.fileViewerBinary', { bytes: byteLength })}</p>
          </div>
        ) : (
          <div className="file-viewer__text-wrapper">
            {isTruncated ? (
              <div
                className="file-viewer__truncation-notice"
                data-testid="file-viewer-truncation"
                style={{ padding: '8px 12px', background: 'var(--color-surface-variant, #f5f5f5)', marginBottom: '12px', borderRadius: '4px', fontSize: '0.85rem' }}
              >
                {t('workspace.fileViewerTruncated', { total: formatBytes(byteLength) })}
              </div>
            ) : null}
            <pre
              className="file-viewer__code"
              data-testid="file-viewer-text"
              style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.9rem', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
            >
              {displayContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
