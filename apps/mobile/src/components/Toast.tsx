import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const TOAST_DURATION_MS = 4000;

export type ToastKind = 'info' | 'success' | 'error';

interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  showToast(message: string, kind?: ToastKind): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast provider: transient, non-blocking feedback messages. Toasts are
 * announced through a polite live region and auto-dismiss.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((previous) => [...previous, { id, message, kind }]);
    // Bare setTimeout so vitest fake timers (globalThis) can control it.
    const timer = setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
    timers.current.push(timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
      timers.current = [];
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-testid="toast" data-kind={toast.kind}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}
