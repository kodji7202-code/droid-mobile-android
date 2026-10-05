import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { useConnectionStore } from '../../stores/connection';
import type {
  DaemonCheckoutGitBranchRequestParams,
  DaemonCheckoutGitBranchResult,
  DaemonListGitBranchesResult,
} from '@droidmobile/daemon-client';

type Resolution = Extract<DaemonCheckoutGitBranchResult, { status: 'needs_resolution' }>;

interface BranchSwitcherSheetProps {
  open: boolean;
  cwd: string;
  online: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function BranchSwitcherSheet({
  open,
  cwd,
  online,
  onClose,
  onChanged,
}: BranchSwitcherSheetProps) {
  const { t } = useTranslation();
  const connection = useConnectionStore((s) => s.connection);
  const [data, setData] = useState<DaemonListGitBranchesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<DaemonCheckoutGitBranchRequestParams | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      setData(await connection.listGitBranches(cwd));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [connection, cwd]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setNewName('');
    setPending(null);
    setResolution(null);
    setBusy(false);
    setData(null);
    void load();
  }, [open, load]);

  const items = useMemo(() => {
    if (!data) return [];
    const local = data.branches.map((name) => ({ name, origin: false }));
    const remote = (data.originBranches ?? []).map((name) => ({ name, origin: true }));
    const needle = search.trim().toLowerCase();
    return [...local, ...remote].filter((b) => b.name.toLowerCase().includes(needle));
  }, [data, search]);

  const runCheckout = async (params: DaemonCheckoutGitBranchRequestParams) => {
    if (!connection || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connection.checkoutGitBranch(params);
      if (result.status === 'needs_resolution') {
        setPending(params);
        setResolution(result);
        return;
      }
      setPending(null);
      setResolution(null);
      onChanged();
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setPending(null);
      setResolution(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void runCheckout({ cwd, branch: name, create: true });
  };

  const canWrite = online && !busy;

  return (
    <Sheet open={open} onClose={onClose} title={t('git.branches.title')} testId="branch-sheet">
      {resolution && pending ? (
        <div
          data-testid="branch-resolution"
          role="alertdialog"
          aria-label={t('git.branches.resolveTitle')}
        >
          <h3>{t('git.branches.resolveTitle')}</h3>
          <p data-testid="branch-resolution-message">{resolution.message}</p>
          <ul data-testid="branch-resolution-counts">
            <li>{t('git.branches.changedFiles', { count: resolution.changedFiles })}</li>
            <li>{t('git.branches.additions', { count: resolution.additions })}</li>
            <li>{t('git.branches.deletions', { count: resolution.deletions })}</li>
            <li>{t('git.branches.untrackedFiles', { count: resolution.untrackedFiles })}</li>
          </ul>
          <div className="sheet__actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="branch-resolution-cancel"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setResolution(null);
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="branch-resolution-stash"
              disabled={!canWrite}
              onClick={() => void runCheckout({ ...pending, resolution: 'stash' })}
            >
              {t('git.branches.stash')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="branch-resolution-commit"
              disabled={!canWrite}
              onClick={() => void runCheckout({ ...pending, resolution: 'commit' })}
            >
              {t('git.branches.commit')}
            </button>
          </div>
          {error ? (
            <p className="field__error" role="alert" data-testid="branch-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <input
            className="field__control"
            data-testid="branch-search-input"
            aria-label={t('git.branches.search')}
            placeholder={t('git.branches.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {loading ? (
            <p role="status" data-testid="branch-loading">
              {t('workspace.loading')}
            </p>
          ) : null}
          {!online ? (
            <p role="status" data-testid="branch-offline">
              {t('git.offline')}
            </p>
          ) : null}
          <ul
            data-testid="branch-list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '8px 0',
              maxHeight: '40vh',
              overflowY: 'auto',
            }}
          >
            {items.map((b) => {
              const current = !b.origin && b.name === data?.currentBranch;
              return (
                <li key={`${b.origin ? 'origin' : 'local'}:${b.name}`}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid={`branch-item-${b.origin ? 'origin/' : ''}${b.name}`}
                    aria-current={current ? 'true' : undefined}
                    disabled={!canWrite || current}
                    onClick={() =>
                      void runCheckout(
                        b.origin
                          ? { cwd, branch: b.name, createFromOrigin: true }
                          : { cwd, branch: b.name },
                      )
                    }
                    style={{ width: '100%', textAlign: 'left', minHeight: 48 }}
                  >
                    <span style={{ fontFamily: 'monospace' }}>{b.name}</span>
                    {current ? (
                      <span className="chip" data-testid="branch-current" style={{ marginLeft: 8 }}>
                        {t('git.branches.current')}
                      </span>
                    ) : null}
                    {b.origin ? (
                      <span className="chip" style={{ marginLeft: 8 }}>
                        {t('git.branches.remote')}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {data && items.length === 0 ? (
            <p data-testid="branch-empty">{t('git.branches.empty')}</p>
          ) : null}
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              className="field__control"
              data-testid="branch-new-input"
              aria-label={t('git.branches.newName')}
              placeholder={t('git.branches.newName')}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError(null);
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn btn--primary"
              data-testid="branch-new-submit"
              disabled={!canWrite || newName.trim() === ''}
            >
              {t('git.branches.create')}
            </button>
          </form>
          {error ? (
            <p className="field__error" role="alert" data-testid="branch-error">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
