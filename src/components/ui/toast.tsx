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
}

const ToastContext = createContext<{ show: (message: string, kind?: Kind) => void } | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, kind: Kind = 'success') => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-2), { id, message, kind }]);
      // Errors stay longer: they usually need reading twice.
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  // An open dialog sits in the browser's top layer, above any z-index. Showing the toasts as a popover, reopened
  // on each new toast, puts them in the top layer too, above the dialog that is open now.
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = region.current;
    if (!el || typeof el.showPopover !== 'function') return;
    if (el.matches(':popover-open')) el.hidePopover();
    if (toasts.length > 0) el.showPopover();
  }, [toasts]);

  return (
    <ToastContext.Provider value={value}>
      <Text>{children}</Text>
      <div ref={region} popover="manual" aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-auto bottom-20 z-[60] m-0 flex w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-4 py-0 md:bottom-6 md:items-end md:px-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-lg',
              toast.kind === 'error' ? 'border-accent-200' : 'border-ink-200',
            )}
          >
            {toast.kind === 'error' ? <AlertCircle className="mt-0.5 size-5 shrink-0 text-accent-600" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-600" aria-hidden />}
            <p className="min-w-0 flex-1 text-sm font-medium text-ink-800"><Text>{toast.message}</Text></p>
            <LocalizedButton type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded text-ink-500 hover:text-ink-700">
              <X className="size-4" aria-hidden />
            </LocalizedButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
