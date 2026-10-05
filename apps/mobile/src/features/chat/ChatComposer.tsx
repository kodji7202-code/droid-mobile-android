import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserAttachment } from '@droidmobile/daemon-client';
import { ATTACH_ACCEPT, readAttachment } from './attachments';
import type { AttachmentRejection } from './attachments';
import { AttachmentThumb } from './AttachmentThumb';

interface ChatComposerProps {
  turnActive: boolean;
  workingState: string;
  disabled: boolean;
  /** Stop lives in the open request dialog, which covers the composer. */
  stopInDialog?: boolean;
  onSend(text: string, attachments: UserAttachment[]): void;
  onInterrupt(): void;
}

export const WAITING_STATE = 'waiting_for_tool_confirmation';
const KNOWN_STATES = ['thinking', 'streaming_assistant_message', 'executing_tool', WAITING_STATE];

export function ChatComposer({
  turnActive,
  workingState,
  disabled,
  stopInDialog = false,
  onSend,
  onInterrupt,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<UserAttachment[]>([]);
  const [rejections, setRejections] = useState<AttachmentRejection[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  // Files are read asynchronously; counting what is already queued keeps the limit exact.
  const attachedCount = useRef(0);
  const canSend = !disabled && !turnActive && text.trim() !== '';
  const indicator = KNOWN_STATES.includes(workingState) ? workingState : 'thinking';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
    setRejections([]);
    attachedCount.current = 0;
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Clearing lets the same file be picked again after it was removed.
    event.target.value = '';
    const accepted: UserAttachment[] = [];
    const rejected: AttachmentRejection[] = [];
    for (const file of files) {
      const result = await readAttachment(file, attachedCount.current);
      if ('attachment' in result) {
        accepted.push(result.attachment);
        attachedCount.current += 1;
      } else {
        rejected.push(result.rejection);
      }
    }
    setRejections(rejected);
    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted]);
  };

  const remove = (index: number) => {
    attachedCount.current -= 1;
    setAttachments((current) => current.filter((_, i) => i !== index));
  };

  return (
    <form className="chat-composer" onSubmit={submit}>
      {turnActive || workingState === WAITING_STATE ? (
        <p
          className="chat-composer__working"
          role="status"
          data-testid="chat-working"
          data-state={indicator}
        >
          {t(`chat.working.${indicator}`)}
        </p>
      ) : null}
      {rejections.length > 0 ? (
        <ul className="chat-composer__rejections" role="alert" data-testid="chat-attach-error">
          {rejections.map((rejection, index) => (
            <li key={`${rejection.name}:${index}`}>
              {t(`chat.attach.reject.${rejection.reason}`, { ...rejection })}
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="chat-composer__attachments" data-testid="chat-attachments">
          {attachments.map((attachment, index) => (
            <li key={index} className="attachment" data-testid={`chat-attachment-${index}`}>
              <AttachmentThumb attachment={attachment} />
              <button
                type="button"
                className="attachment__remove"
                data-testid={`chat-attachment-remove-${index}`}
                aria-label={t('chat.attach.remove', {
                  name: attachment.kind === 'file' ? attachment.name : t('chat.attach.image'),
                })}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chat-composer__row">
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={ATTACH_ACCEPT}
          data-testid="chat-attach-input"
          onChange={(event) => void pick(event)}
        />
        <button
          type="button"
          className="btn btn--secondary chat-composer__button"
          data-testid="chat-attach"
          aria-label={t('chat.attach.label')}
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          +
        </button>
        <textarea
          className="field__control chat-composer__input"
          data-testid="chat-input"
          aria-label={t('chat.inputLabel')}
          placeholder={t('chat.inputPlaceholder')}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
        {turnActive && !stopInDialog ? (
          <button
            type="button"
            className="btn btn--secondary chat-composer__button"
            data-testid="chat-interrupt"
            onClick={onInterrupt}
          >
            {t('chat.interrupt')}
          </button>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary chat-composer__button"
          data-testid="chat-send"
          disabled={!canSend}
        >
          {t('chat.send')}
        </button>
      </div>
    </form>
  );
}
