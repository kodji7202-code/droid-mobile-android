import { useTranslation } from 'react-i18next';
import type { ExtraKey } from './terminalKeys';

interface ExtraKeysBarProps {
  ctrlArmed: boolean;
  disabled: boolean;
  onKey: (key: ExtraKey) => void;
  onToggleCtrl: () => void;
}

const KEYS: Array<{ key: ExtraKey; label: string; i18n: string }> = [
  { key: 'esc', label: 'Esc', i18n: 'terminal.keys.esc' },
  { key: 'tab', label: 'Tab', i18n: 'terminal.keys.tab' },
];

const ARROWS: Array<{ key: ExtraKey; label: string; i18n: string }> = [
  { key: 'up', label: '↑', i18n: 'terminal.keys.up' },
  { key: 'down', label: '↓', i18n: 'terminal.keys.down' },
  { key: 'left', label: '←', i18n: 'terminal.keys.left' },
  { key: 'right', label: '→', i18n: 'terminal.keys.right' },
];

/**
 * Buttons keep the xterm input focused (pointer-down is not allowed to move
 * focus) so tapping them never dismisses the soft keyboard.
 */
export function ExtraKeysBar({ ctrlArmed, disabled, onKey, onToggleCtrl }: ExtraKeysBarProps) {
  const { t } = useTranslation();
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();
  const button = (key: ExtraKey, label: string, i18n: string) => (
    <button
      key={key}
      type="button"
      className="terminal-key"
      data-testid={`terminal-key-${key}`}
      aria-label={t(i18n)}
      disabled={disabled}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={() => onKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="terminal-keys"
      data-testid="terminal-extra-keys"
      role="toolbar"
      aria-label={t('terminal.keys.label')}
    >
      {KEYS.map((k) => button(k.key, k.label, k.i18n))}
      <button
        type="button"
        className={`terminal-key${ctrlArmed ? ' terminal-key--active' : ''}`}
        data-testid="terminal-key-ctrl"
        aria-label={t('terminal.keys.ctrl')}
        aria-pressed={ctrlArmed}
        disabled={disabled}
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={onToggleCtrl}
      >
        Ctrl
      </button>
      {ARROWS.map((k) => button(k.key, k.label, k.i18n))}
    </div>
  );
}
