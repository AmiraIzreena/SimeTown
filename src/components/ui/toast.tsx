'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton } from '@/components/ui/localized-elements';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Kind = 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  kind: Kind;
  /** How long it stays, for the countdown bar. */
  ms: number;
  /** Fading out after a dismiss or timeout. */
  leaving?: boolean;
}

/** How long a toast takes to fade out (matches .toast-leaving in globals.css). */
const LEAVE_MS = 180;

const ToastContext = createContext<{ show: (message: string, kind?: Kind) => void } | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // A dismissed toast fades out first, then leaves the list. Reduced motion removes it at once.
  const dismiss = useCallback((id: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setToasts((list) => list.filter((t) => t.id !== id));
      return;
    }
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);
  const show = useCallback((message: string, kind: Kind = 'success') => {
    // Errors stay longer: they usually need reading twice.
    const ms = kind === 'error' ? 7000 : 4500;
    setToasts((list) => [...list.slice(-2), { id: nextId++, message, kind, ms }]);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  // An open dialog sits in the browser's top layer, above any z-index. Showing the toasts as a popover, reopened
  // on each new toast, puts them in the top layer too, above the dialog that is open now. Only a new toast
  // reopens it, so the toasts still showing keep their countdown when another one leaves.
  const region = useRef<HTMLDivElement>(null);
  const newestShown = useRef(0);
  useEffect(() => {
    const el = region.current;
    if (!el || typeof el.showPopover !== 'function') return;
    const newest = toasts.at(-1)?.id ?? 0;
    if (toasts.length === 0) {
      if (el.matches(':popover-open')) el.hidePopover();
    } else if (newest !== newestShown.current) {
      newestShown.current = newest;
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    }
  }, [toasts]);

  return (
    <ToastContext.Provider value={value}>
      <Text>{children}</Text>
      <div ref={region} popover="manual" aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-auto bottom-20 z-[60] m-0 flex w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-4 py-0 md:bottom-6 md:items-end md:px-6">
        {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * One toast. It closes itself when its time runs out, but the clock and the countdown bar pause
 * while the pointer is over it or focus is inside it, so a message is never pulled away mid-read.
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(toast.ms);
  // An error stays until it is dismissed: it usually says how to recover, which takes reading.
  const sticky = toast.kind === 'error';
  useEffect(() => {
    if (sticky || paused || toast.leaving) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [sticky, paused, toast.leaving, toast.id, onDismiss]);

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'pointer-events-auto relative flex w-full max-w-sm animate-rise items-start gap-3 overflow-hidden rounded-lg border bg-white px-4 py-3 shadow-lg',
        toast.kind === 'error' ? 'border-accent-200' : 'border-ink-200',
        toast.leaving && 'toast-leaving',
      )}
    >
      {toast.kind === 'error' ? <AlertCircle className="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden />}
      <p className="min-w-0 flex-1 text-sm font-medium text-ink-800"><Text>{toast.message}</Text></p>
      <LocalizedButton type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded text-ink-500 hover:text-ink-700">
        <X className="size-4" aria-hidden />
      </LocalizedButton>
      {!sticky && (
        <span
          aria-hidden
          style={{ animationDuration: `${toast.ms}ms`, animationPlayState: paused || toast.leaving ? 'paused' : 'running' }}
          className="toast-life absolute inset-x-0 bottom-0 h-0.5 bg-success-600/50"
        />
      )}
    </div>
  );
}
