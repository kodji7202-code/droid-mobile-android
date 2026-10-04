import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canApproveAlways } from '@droidmobile/daemon-client';
import type { AskUserAnswer, PermissionDecision } from '@droidmobile/daemon-client';
import type { PendingInteraction } from '../../stores/interactions';
import { describePermission } from './permissionDetail';

type PermissionEntry = Extract<PendingInteraction, { kind: 'permission' }>;
type AskUserEntry = Extract<PendingInteraction, { kind: 'askuser' }>;

/**
 * The daemon is blocked on this request, so the dialog has no backdrop dismiss:
 * every way out is an explicit answer.
 */
export function PermissionDialog({
  entry,
  onDecide,
  onStop,
}: {
  entry: PermissionEntry;
  onDecide(decision: PermissionDecision): void;
  onStop(): void;
}) {
  const { t } = useTranslation();
  const details = describePermission(entry.request);
  return (
    <div className="dialog-backdrop" data-testid="permission-backdrop">
      <div
        className="dialog interaction-dialog"
        data-testid="permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.permission.title')}
      >
        <h2 className="dialog__title">{t('chat.permission.title')}</h2>
        <div className="interaction-dialog__scroll">
          {details.map((detail) => (
            <section
              key={detail.toolUseId}
              className="interaction-dialog__detail"
              data-testid={`permission-detail-${detail.toolUseId}`}
            >
              <p className="interaction-dialog__tool">
                <span className="tool-card__label">{t('chat.permission.tool')}</span>{' '}
                <strong data-testid="permission-tool">{detail.toolName}</strong>
              </p>
              {detail.body.kind === 'command' ? (
                <>
                  <p className="tool-card__label">{t('chat.permission.command')}</p>
                  <pre className="tool-card__pre" data-testid="permission-command">
                    {detail.body.command}
                  </pre>
                </>
              ) : null}
              {detail.body.kind === 'diff' ? (
                <>
                  <p className="tool-card__label">{t('chat.permission.file')}</p>
                  <p data-testid="permission-file">{detail.body.fileName}</p>
                  <pre className="tool-card__pre" data-testid="permission-diff">
                    {detail.body.diff}
                  </pre>
                </>
              ) : null}
              {detail.body.kind === 'patch' ? (
                <>
                  <p className="tool-card__label">{t('chat.permission.file')}</p>
                  <p data-testid="permission-file">{detail.body.fileName}</p>
                  <pre className="tool-card__pre" data-testid="permission-diff">
                    {detail.body.patch}
                  </pre>
                </>
              ) : null}
              {detail.body.kind === 'input' ? (
                <pre className="tool-card__pre" data-testid="permission-input">
                  {detail.body.text}
                </pre>
              ) : null}
            </section>
          ))}
        </div>
        <div className="dialog__actions interaction-dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="chat-interrupt"
            onClick={onStop}
          >
            {t('chat.interrupt')}
          </button>{' '}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="permission-deny"
            onClick={() => onDecide('deny')}
          >
            {t('chat.permission.deny')}
          </button>
          {canApproveAlways(entry.request) ? (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="permission-approve-always"
              onClick={() => onDecide('always')}
            >
              {t('chat.permission.approveAlways')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            data-testid="permission-approve-once"
            onClick={() => onDecide('once')}
          >
            {t('chat.permission.approveOnce')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AskUserDialog({
  entry,
  onAnswer,
  onStop,
}: {
  entry: AskUserEntry;
  onAnswer(answer: AskUserAnswer): void;
  onStop(): void;
}) {
  const { t } = useTranslation();
  const { questions } = entry.request;
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const complete = questions.every((question) => (chosen[question.index] ?? []).length > 0);

  const toggle = (index: number, option: string, multi: boolean) =>
    setChosen((current) => {
      const selected = current[index] ?? [];
      if (!multi) return { ...current, [index]: [option] };
      return {
        ...current,
        [index]: selected.includes(option)
          ? selected.filter((value) => value !== option)
          : [...selected, option],
      };
    });

  return (
    <div className="dialog-backdrop" data-testid="askuser-backdrop">
      <form
        className="dialog interaction-dialog"
        data-testid="askuser-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.askUser.title')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          onAnswer({
            answers: questions.map((question) => ({
              index: question.index,
              question: question.question,
              answer: (chosen[question.index] ?? []).join(', '),
            })),
          });
        }}
      >
        <h2 className="dialog__title">{t('chat.askUser.title')}</h2>
        <div className="interaction-dialog__scroll">
          {questions.map((question) => {
            const multi = question.multiSelect === true;
            return (
              <fieldset
                key={question.index}
                className="interaction-dialog__question"
                data-testid={`askuser-question-${question.index}`}
              >
                <legend data-testid={`askuser-question-text-${question.index}`}>
                  {question.question}
                </legend>
                {multi ? <p className="tool-card__label">{t('chat.askUser.multiHint')}</p> : null}
                {question.options.map((option, optionIndex) => (
                  <label
                    key={`${option}:${optionIndex}`}
                    className="interaction-dialog__option"
                    data-testid={`askuser-option-${question.index}-${optionIndex}`}
                  >
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`askuser-${question.index}`}
                      checked={(chosen[question.index] ?? []).includes(option)}
                      onChange={() => toggle(question.index, option, multi)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="dialog__actions interaction-dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="chat-interrupt"
            onClick={onStop}
          >
            {t('chat.interrupt')}
          </button>{' '}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="askuser-cancel"
            onClick={() => onAnswer({ cancelled: true, answers: [] })}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="askuser-submit"
            disabled={!complete}
          >
            {t('chat.askUser.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
