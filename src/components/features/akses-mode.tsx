'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Text } from '@/components/ui/localized-text';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { setPlainLanguage, speak, useLang, useT } from '@/lib/i18n';
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

/*
 * Two independent display modes, both for residents:
 *
 * - Accessible view (the top-bar switch) changes only how screens look: larger text, larger tap targets and a
 *   labelled menu, everywhere at once (dialogs, toasts and the bars included).
 * - Simple Mode (the saved Akses+ setting) changes how screens work: the four-button home, forms that ask one
 *   question at a time, plainer wording and calmer surfaces.
 *
 * Either can be on without the other. AksesModesProvider works both out once, in the Shell, and marks <html> with
 * data-akses-view / data-simple-mode so the styles in globals.css reach every page and every overlay.
 */
export interface AksesModes {
  profile?: AksesProfile;
  /** Accessible view: larger text and targets. */
  accessibleView: boolean;
  /** Simple Mode: the simplified experience. */
  simple: boolean;
  /** Forms ask one question at a time. Part of Simple Mode. */
  guided: boolean;
  largeText: boolean;
  largeTargets: boolean;
  /** Turns the top-bar switch on or off. Remembered per account in this browser. */
  setAccessibleView: (on: boolean) => void;
}

const AksesModesContext = createContext<AksesModes | null>(null);

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

/* "Full app" on the Simple Mode home lasts for this visit (this tab), not for good. */
const FULL_APP_KEY = 'kita.fullApp';

export function readFullAppChoice(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(FULL_APP_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFullAppChoice(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(FULL_APP_KEY, '1');
    else window.sessionStorage.removeItem(FULL_APP_KEY);
  } catch {
    /* storage blocked: the choice lasts until the page reloads */
  }
}

/** Works out both modes from the saved Akses+ profile and this browser's top-bar choice. */
function useResolvedModes(userId: string | undefined, enabled: boolean): AksesModes {
  const access = useApi<AksesProfile>(enabled ? '/me/access' : null);
  const [viewChoice, setAccessibleView] = useAccessibleViewChoice(enabled ? userId : undefined);
  const needs = access.data?.needs ?? [];
  // Before the resident ever uses the switch, any saved access need turns Accessible view on.
  const accessibleView = enabled && (viewChoice ?? needs.length > 0);
  const simple = enabled && Boolean(access.data?.simpleMode);
  const profile = access.data;
  return useMemo(
    () => ({ profile, accessibleView, simple, guided: simple, largeText: accessibleView, largeTargets: accessibleView || simple, setAccessibleView }),
    [profile, accessibleView, simple, setAccessibleView],
  );
}

/**
 * Provides both modes to every screen in the frame and marks <html> so the mode styles reach overlays too
 * (dialogs, the menu drawer, toasts and pop-ups live outside the page's own box). Only residents have the modes.
 */
export function AksesModesProvider({ userId, enabled, children }: { userId: string | undefined; enabled: boolean; children: ReactNode }) {
  const modes = useResolvedModes(userId, enabled);
  const { accessibleView, simple, profile } = modes;
  // Turning Simple Mode off forgets "Full app", so turning it on again opens the simple home.
  useEffect(() => {
    if (profile && !simple) setFullAppChoice(false);
  }, [profile, simple]);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-akses-view', accessibleView);
    root.toggleAttribute('data-simple-mode', simple);
    setPlainLanguage(simple);
    return () => {
      root.removeAttribute('data-akses-view');
      root.removeAttribute('data-simple-mode');
      setPlainLanguage(false);
    };
  }, [accessibleView, simple]);
  return <AksesModesContext.Provider value={modes}>{children}</AksesModesContext.Provider>;
}

/** Both modes, as the Shell worked them out. Outside a resident frame, both are off. */
export function useAksesMode(): AksesModes {
  return useContext(AksesModesContext) ?? OFF;
}

const OFF: AksesModes = { accessibleView: false, simple: false, guided: false, largeText: false, largeTargets: false, setAccessibleView: () => undefined };

/** The box around a resident screen. The mode styles themselves hang off <html> (see AksesModesProvider). */
export function AksesPage({ children, className }: { children: ReactNode; className?: string }) {
  const { simple, largeText, largeTargets } = useAksesMode();
  return (
    <div className={cn('akses-page', simple && 'akses-simple-mode', largeText && 'akses-large-text', largeTargets && 'akses-large-targets', className)}>
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
