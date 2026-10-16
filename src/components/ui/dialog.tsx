'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedButton, LocalizedDialog } from '@/components/ui/localized-elements';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Opens and closes a native <dialog> to match the `open` prop. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return {
    ref,
    onClose,
    // A click on the backdrop lands on the dialog element itself.
    onClick: (event: React.MouseEvent<HTMLDialogElement>) => {
      if (event.target === ref.current) onClose();
    },
  };
}

function Frame({ title, description, onClose, children, footer }: Omit<DialogProps, 'open'>) {
  return (
    <div className="flex max-h-[inherit] flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold"><Text>{title}</Text></h2>
          {description && <p className="mt-0.5 text-sm text-ink-500"><Text>{description}</Text></p>}
        </div>
        <LocalizedButton type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-md text-ink-500 transition-colors duration-200 hover:bg-ink-100 hover:text-ink-800">
          <X className="size-5" aria-hidden />
        </LocalizedButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><Text>{children}</Text></div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-25 px-5 py-3.5"><Text>{footer}</Text></div>}
    </div>
  );
}

/** A centred dialog on larger screens and a bottom sheet on phones. */
export function Modal({ open, wide, className, ...props }: DialogProps & { wide?: boolean; className?: string }) {
  const dialog = useDialog(open, props.onClose);
  return (
    <LocalizedDialog {...dialog} className={cn('modal', wide && 'wide', className)} aria-label={props.title}>
      {open && <Frame {...props} />}
    </LocalizedDialog>
  );
}

/** A panel that slides in from the side. Used for mobile navigation and notifications. */
export function Drawer({ open, side = 'left', ...props }: DialogProps & { side?: 'left' | 'right' }) {
  const dialog = useDialog(open, props.onClose);
  return (
    <LocalizedDialog {...dialog} className={cn('drawer', side)} aria-label={props.title}>
      {open && <Frame {...props} />}
    </LocalizedDialog>
  );
}

/** Asks before something that cannot be undone, or that moves money. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, destructive, pending }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} pending={pending}>
            <Text>{confirmLabel}</Text>
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[15px] text-ink-700"><Text>{children}</Text></div>
    </Modal>
  );
}
