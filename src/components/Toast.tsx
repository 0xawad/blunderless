import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { copy } from '../copy';

export type ToastTone = 'neutral' | 'good' | 'bad';

export interface ToastOptions {
  /** One button inside the toast (Retry, Undo). Pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** Keep it on screen until dismissed. Errors ('bad') always are. */
  sticky?: boolean;
}

export type ShowToast = (text: string, tone?: ToastTone, options?: ToastOptions) => void;

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
  sticky: boolean;
  action?: ToastOptions['action'];
}

const MAX_VISIBLE = 3;
/** How long a passing toast stays: a base plus reading time, longer when it carries a button. */
const lifetime = (t: ToastItem) => Math.min(10_000, 3200 + t.text.length * 40 + (t.action ? 3000 : 0));
/** A toast that would expire while the pointer or keyboard focus is on the stack waits this long and checks again. */
const HOLD = 1500;

const Ctx = createContext<ShowToast>(() => {});

/**
 * `toast(text, tone?, options?)`. Passing messages leave on their own; errors
 * ('bad') stay until dismissed and are announced at once, because a toast is
 * often the only report that something failed.
 */
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // The same list, readable synchronously: show() and the timers must not depend on render timing.
  const list = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const commit = useCallback((next: ToastItem[]) => {
    list.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      commit(list.current.filter((t) => t.id !== id));
    },
    [commit],
  );

  const arm: (t: ToastItem, ms?: number) => void = useCallback(
    (t, ms = lifetime(t)) => {
      window.clearTimeout(timers.current.get(t.id));
      if (t.sticky) return;
      const expire = () => {
        const el = box.current;
        // Don't pull a toast out from under someone reading it or reaching for its button.
        if (el && (el.matches(':hover') || el.contains(document.activeElement))) arm(t, HOLD);
        else dismiss(t.id);
      };
      timers.current.set(t.id, window.setTimeout(expire, ms));
    },
    [dismiss],
  );

  const show = useCallback<ShowToast>(
    (text, tone = 'neutral', options) => {
      const item: ToastItem = { id: ++seq.current, text, tone, sticky: tone === 'bad' || !!options?.sticky, action: options?.action };
      // The same message again (a retry that failed the same way) replaces the one on screen instead of stacking.
      const next = [...list.current.filter((t) => t.text !== text || t.tone !== tone), item].slice(-MAX_VISIBLE);
      for (const old of list.current) {
        if (next.includes(old)) continue;
        window.clearTimeout(timers.current.get(old.id));
        timers.current.delete(old.id);
      }
      commit(next);
      arm(item);
    },
    [arm, commit],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" ref={box} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'bad' ? 'alert' : undefined}>
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.sticky && (
              <button type="button" className="toast-close" aria-label={copy.toast.dismiss} title={copy.toast.dismiss} onClick={() => dismiss(t.id)}>
                <span aria-hidden>×</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
