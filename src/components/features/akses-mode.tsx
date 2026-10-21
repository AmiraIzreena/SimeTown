'use client';

import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { speak, useLang, useT } from '@/lib/i18n';
import type { AccessNeed } from '@/shared/domain';

export interface AksesProfile {
  needs: AccessNeed[];
  simpleMode: boolean;
  readAloud: boolean;
  flashAlerts: boolean;
  priorityHelp: boolean;
  priorityNote: string | null;
  consentAt: string | null;
}

export const AksesViewContext = createContext<boolean | null>(null);

/*
 * The "Accessible view / Standard view" switch in the top bar. The resident's choice is remembered in this browser,
 * per account, so it holds on every page (the app pages and Notifications have separate frames), after a refresh
 * and in other tabs, until they switch again. Before they ever switch, their saved Akses+ profile decides.
 */
const viewKey = (userId: string) => `simetown:accessible-view:${userId}`;
const viewListeners = new Set<() => void>();

function readViewChoice(userId: string | undefined): boolean | null {
  if (!userId) return null;
  try {
    const value = window.localStorage.getItem(viewKey(userId));
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch {
    return null;
  }
}

export function useAccessibleViewChoice(userId: string | undefined): [boolean | null, (on: boolean) => void] {
  const subscribe = useCallback((notify: () => void) => {
    viewListeners.add(notify);
    // Another tab switched it.
    const onStorage = (event: StorageEvent) => { if (userId && event.key === viewKey(userId)) notify(); };
    window.addEventListener('storage', onStorage);
    return () => {
      viewListeners.delete(notify);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);
  const stored = useSyncExternalStore(subscribe, () => readViewChoice(userId), () => null);
  // Still works for this visit when the browser blocks storage (a private window, say).
  const [local, setLocal] = useState<boolean | null>(null);
  const choose = useCallback((on: boolean) => {
    setLocal(on);
    if (!userId) return;
    try {
      window.localStorage.setItem(viewKey(userId), on ? 'on' : 'off');
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    viewListeners.forEach((listener) => listener());
  }, [userId]);
  return [stored ?? local, choose];
}

export function useAksesMode() {
  const access = useApi<AksesProfile>('/me/access');
  const needs = access.data?.needs ?? [];
  const override = useContext(AksesViewContext);
  const savedSimple = Boolean(access.data?.simpleMode || needs.includes('COGNITIVE') || needs.includes('ELDERLY'));
  const savedGuided = Boolean(access.data?.simpleMode || needs.length > 0);
  const simple = override ?? savedSimple;
  const guided = override ?? savedGuided;
  const largeText = override ?? (needs.includes('VISION') || needs.includes('ELDERLY'));
  const largeTargets = override ?? (needs.includes('MOBILITY') || needs.includes('COGNITIVE') || needs.includes('ELDERLY'));

  return { profile: access.data, simple, guided, largeText, largeTargets };
}

export function AksesPage({ profile, simple, largeText, largeTargets, children, className }: {
  profile?: AksesProfile;
  simple?: boolean;
  largeText?: boolean;
  largeTargets?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const needs = profile?.needs ?? [];
  const isSimple = simple ?? Boolean(profile?.simpleMode || needs.includes('COGNITIVE') || needs.includes('ELDERLY'));
  const useLargeText = largeText ?? (needs.includes('VISION') || needs.includes('ELDERLY'));
  const useLargeTargets = largeTargets ?? (needs.includes('MOBILITY') || needs.includes('COGNITIVE') || needs.includes('ELDERLY') || isSimple);

  return (
    <div className={cn('akses-page', isSimple && 'akses-simple-mode', useLargeText && 'akses-large-text', useLargeTargets && 'akses-large-targets', className)}>
      {children}
    </div>
  );
}

export function AksesReadAloud({ profile, text }: { profile?: AksesProfile; text: string }) {
  const lang = useLang();
  if (!profile?.readAloud) return null;

  return (
    <Button variant="secondary" size="lg" onClick={() => speak(text, lang)}>
      <Volume2 className="size-5" aria-hidden />
      <Text>Read aloud</Text>
    </Button>
  );
}

export function AksesWizard({ open, title, step, total, children, onClose, onBack, onNext, onSubmit, pending, submitLabel = 'Save' }: {
  open: boolean;
  title: string;
  step: number;
  total: number;
  children: ReactNode;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  pending?: boolean;
  submitLabel?: string;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      wide
      className="guided-modal"
      onClose={onClose}
      title={title}
      description={t('Question {step} of {total}', { step: step + 1, total })}
      footer={
        <>
          {step > 0 && <Button size="lg" variant="secondary" onClick={onBack}><Text>Back</Text></Button>}
          <Button size="lg" variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          {step < total - 1
            ? <Button size="lg" onClick={onNext}><Text>Next</Text></Button>
            : <Button size="lg" onClick={onSubmit} pending={pending}><Text>{submitLabel}</Text></Button>}
        </>
      }
    >
      <div className="flex min-h-64 flex-col justify-center gap-5">{children}</div>
    </Modal>
  );
}
