import { useTranslation } from 'react-i18next';
import type { ContextBreakdown, SessionHandle } from '@droidmobile/daemon-client';
import { ErrorState } from '../../components/ErrorState';
import { Sheet } from '../../components/Sheet';
import { Skeleton } from '../../components/Skeleton';
import { useContextBreakdown } from './useContextBreakdown';

interface ContextUsageSheetProps {
  open: boolean;
  onClose: () => void;
  handle: SessionHandle | undefined;
  /** Changes whenever a turn finishes so an open sheet reloads. */
  refreshKey: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  systemPrompt: 'hsl(231 70% 60%)',
  systemTools: 'hsl(199 80% 45%)',
  mcpTools: 'hsl(168 65% 38%)',
  userInfo: 'hsl(43 85% 48%)',
  agentsMd: 'hsl(24 85% 55%)',
  customAgents: 'hsl(338 70% 55%)',
  skills: 'hsl(280 55% 58%)',
  messages: 'hsl(140 50% 42%)',
};
const FALLBACK_COLOR = 'hsl(220 10% 55%)';

const categoryColor = (key: string) => CATEGORY_COLORS[key] ?? FALLBACK_COLOR;
const format = (value: number) => value.toLocaleString();

export function contextPercent(used: number, budget: number): number {
  return budget > 0 ? Math.round((used / budget) * 100) : 0;
}

interface NamedListProps {
  testId: string;
  title: string;
  emptyLabel: string;
  items: { key: string; name: string; tokens: number }[];
}

function NamedList({ testId, title, emptyLabel, items }: NamedListProps) {
  return (
    <section className="context-usage__section" data-testid={testId} data-count={items.length}>
      <h3 className="context-usage__heading">{title}</h3>
      {items.length === 0 ? (
        <p className="context-usage__empty" data-testid={`${testId}-empty`}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="context-usage__list">
          {items.map((item) => (
            <li key={item.key} className="context-usage__row" data-testid={`${testId}-item`}>
              <span>{item.name}</span>
              <span>{format(item.tokens)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Breakdown({ data }: { data: ContextBreakdown }) {
  const { t } = useTranslation();
  const percent = contextPercent(data.usedTokens, data.contextBudget);
  const budget = Math.max(data.contextBudget, 1);
  return (
    <div className="context-usage" data-testid="context-usage-ready">
      <p className="context-usage__model" data-testid="context-usage-model">
        {data.modelDisplayName}
      </p>
      <dl className="context-usage__totals">
        <div>
          <dt>{t('session.context.used')}</dt>
          <dd data-testid="context-usage-used" data-value={data.usedTokens}>
            {format(data.usedTokens)}
          </dd>
        </div>
        <div>
          <dt>{t('session.context.free')}</dt>
          <dd data-testid="context-usage-free" data-value={data.freeTokens}>
            {format(data.freeTokens)}
          </dd>
        </div>
        <div>
          <dt>{t('session.context.budget')}</dt>
          <dd data-testid="context-usage-budget" data-value={data.contextBudget}>
            {format(data.contextBudget)}
          </dd>
        </div>
      </dl>
      <div
        className="context-usage__bar"
        role="img"
        aria-label={t('session.context.percentLabel', { percent })}
        data-testid="context-usage-bar"
        data-percent={percent}
      >
        {data.categories.map((category) => (
          <span
            key={category.name}
            className="context-usage__segment"
            data-testid="context-usage-segment"
            style={{
              width: `${(category.tokens / budget) * 100}%`,
              backgroundColor: categoryColor(category.colorKey),
            }}
          />
        ))}
      </div>
      <p className="context-usage__percent" data-testid="context-usage-percent">
        {t('session.context.percent', { percent })}
      </p>

      <section
        className="context-usage__section"
        data-testid="context-usage-categories"
        data-count={data.categories.length}
      >
        <h3 className="context-usage__heading">{t('session.context.categories')}</h3>
        {data.categories.length === 0 ? (
          <p className="context-usage__empty" data-testid="context-usage-categories-empty">
            {t('session.context.noCategories')}
          </p>
        ) : (
          <ul className="context-usage__list">
            {data.categories.map((category) => (
              <li
                key={category.name}
                className="context-usage__row"
                data-testid="context-usage-category"
                data-tokens={category.tokens}
              >
                <span className="context-usage__name">
                  <span
                    className="context-usage__swatch"
                    aria-hidden="true"
                    style={{ backgroundColor: categoryColor(category.colorKey) }}
                  />
                  {t(`session.context.category.${category.colorKey}`, {
                    defaultValue: category.name,
                  })}
                </span>
                <span>{format(category.tokens)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NamedList
        testId="context-usage-skills"
        title={t('session.context.skills')}
        emptyLabel={t('session.context.noSkills')}
        items={data.skills.map((s) => ({ key: `${s.location}:${s.name}`, ...s }))}
      />
      <NamedList
        testId="context-usage-mcp"
        title={t('session.context.mcpServers')}
        emptyLabel={t('session.context.noMcpServers')}
        items={data.mcpServers.map((s) => ({ key: s.name, ...s }))}
      />
      <NamedList
        testId="context-usage-droids"
        title={t('session.context.droids')}
        emptyLabel={t('session.context.noDroids')}
        items={data.droids.map((d) => ({ key: `${d.location}:${d.name}`, ...d }))}
      />
    </div>
  );
}

export function ContextUsageSheet({ open, onClose, handle, refreshKey }: ContextUsageSheetProps) {
  const { t } = useTranslation();
  const { state, reload } = useContextBreakdown(handle, open, refreshKey);

  return (
    <Sheet open={open} onClose={onClose} title={t('session.context.title')} testId="context-usage">
      {state.status === 'loading' ? (
        <div data-testid="context-usage-loading">
          <Skeleton lines={4} />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState
          title={t('session.context.failedTitle')}
          message={t('session.context.failed')}
          retryLabel={t('common.retry')}
          onRetry={reload}
        />
      ) : null}
      {state.status === 'ready' ? <Breakdown data={state.data} /> : null}
    </Sheet>
  );
}
