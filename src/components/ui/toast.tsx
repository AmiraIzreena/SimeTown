'use client';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
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
            <p className="min-w-0 flex-1 text-sm font-medium text-ink-800">{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded text-ink-500 hover:text-ink-700">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
