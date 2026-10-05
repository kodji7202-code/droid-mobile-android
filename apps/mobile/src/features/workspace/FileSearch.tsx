import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, FileIcon, SearchIcon } from '../../components/icons';
import { useConnectionStore } from '../../stores/connection';

const SEARCH_DEBOUNCE_MS = 250;

interface FileSearchProps {
  sessionId: string;
  query: string;
  showHidden: boolean;
  onQueryChange: (query: string) => void;
  onSelectFile: (path: string) => void;
  onClear: () => void;
}

export function FileSearch({
  sessionId,
  query,
  showHidden,
  onQueryChange,
  onSelectFile,
  onClear,
}: FileSearchProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const searchSeq = useRef(0);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery === '') {
      setResults([]);
      setLoading(false);
      setSettled(false);
      return undefined;
    }

    if (!connection) {
      setLoading(false);
      setSettled(true);
      return undefined;
    }

    const seq = ++searchSeq.current;
    setLoading(true);
    setSettled(false);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hits = await connection.searchFiles(
            sessionId,
            trimmedQuery,
            undefined,
            showHidden,
          );
          if (seq === searchSeq.current) {
            setResults(hits);
            setSettled(true);
            setLoading(false);
          }
        } catch {
          if (seq === searchSeq.current) {
            setResults([]);
            setSettled(true);
            setLoading(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [sessionId, trimmedQuery, showHidden, connection]);

  const highlightMatch = (path: string, match: string) => {
    const normalised = path.replace(/\\/g, '/');
    if (!match) return normalised;

    const lower = normalised.toLowerCase();
    const qLower = match.toLowerCase();
    const idx = lower.indexOf(qLower);

    if (idx === -1) return normalised;

    const before = normalised.slice(0, idx);
    const matched = normalised.slice(idx, idx + match.length);
    const after = normalised.slice(idx + match.length);

    return (
      <>
        {before}
        <strong className="search-match-highlight">{matched}</strong>
        {after}
      </>
    );
  };

  return (
    <div className="workspace-search" data-testid="workspace-search">
      <div className="workspace-search__input-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span className="workspace-search__icon" style={{ position: 'absolute', left: '10px', pointerEvents: 'none', opacity: 0.7 }}>
          <SearchIcon width={18} height={18} />
        </span>
        <input
          type="search"
          className="field__control workspace-search__input"
          data-testid="workspace-search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('workspace.searchPlaceholder')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ paddingLeft: '34px', paddingRight: query ? '34px' : '10px' }}
        />
        {query ? (
          <button
            type="button"
            className="workspace-search__clear-btn"
            data-testid="workspace-search-clear"
            aria-label={t('workspace.clearSearch')}
            onClick={() => {
              onClear();
            }}
            style={{
              position: 'absolute',
              right: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CloseIcon width={16} height={16} />
          </button>
        ) : null}
      </div>

      {trimmedQuery && (
        <div className="workspace-search__body" style={{ marginTop: '12px' }}>
          {loading ? (
            <p className="workspace-search__status" data-testid="workspace-search-loading">
              {t('workspace.loading')}
            </p>
          ) : settled && results.length === 0 ? (
            <div className="workspace-search__no-results" data-testid="search-no-results">
              <p>{t('workspace.searchNoResults')}</p>
            </div>
          ) : (
            <ul
              className="workspace-search__results"
              data-testid="workspace-search-results"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {results.map((hitPath) => {
                const normPath = hitPath.replace(/\\/g, '/');
                const lastSlash = normPath.lastIndexOf('/');
                const fileName = lastSlash >= 0 ? normPath.slice(lastSlash + 1) : normPath;
                const dirName = lastSlash >= 0 ? normPath.slice(0, lastSlash) : '';

                return (
                  <li key={normPath}>
                    <button
                      type="button"
                      className="workspace-search__result-item"
                      data-testid={`search-result-${normPath}`}
                      onClick={() => onSelectFile(normPath)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        textAlign: 'left',
                        padding: '10px 8px',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--color-border, #eee)',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ marginRight: '8px', opacity: 0.7 }}>
                        <FileIcon width={18} height={18} />
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="workspace-search__result-name" style={{ fontWeight: 500 }}>
                          {highlightMatch(fileName, trimmedQuery)}
                        </span>
                        {dirName ? (
                          <span
                            className="workspace-search__result-dir"
                            style={{ fontSize: '0.85em', opacity: 0.6 }}
                          >
                            {highlightMatch(dirName, trimmedQuery)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
