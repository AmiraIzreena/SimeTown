'use client';

import { Text } from '@/components/ui/localized-text';

import { Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { reloadTo } from '@/lib/navigate';
import { IDLE_WARNING_MS } from '@/shared/session';

/**
 * Signs a person out after the inactivity limit of their role, and at the end of the longest sign-in (12 hours),
 * with a warning 2 minutes before so they can stay signed in (WCAG 2.2.1). The server enforces both; this only
 * warns in time and leaves cleanly.
 *
 * Activity is a tap, a key, a scroll or a wheel, never a screen refreshing itself. It is sent to the server at most
 * once a minute, and the countdown runs from the last time the server heard of it, so the two agree. Other tabs
 * hear of it through the browser's storage, so working in one tab keeps the others signed in.
 */

interface SessionState {
  idleMinutes: number | null;
  lastActiveAt: string;
  expiresAt: string;
  /** The server's clock when it answered, to allow for a device clock that is off. */
  now: string;
}

const PING_EVERY_MS = 60_000;
const SHARED_KEY = 'kita.session-activity';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(SHARED_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeShared(at: number) {
  try {
    window.localStorage.setItem(SHARED_KEY, String(at));
  } catch {
    // Private windows may refuse storage: this tab still works on its own.
  }
}
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function SessionTimeout() {
  const [state, setState] = useState<{ idleMs: number | null; expiresAt: number; skew: number } | null>(null);
  const [warning, setWarning] = useState<{ kind: 'idle' | 'end'; left: number } | null>(null);
  const [staying, setStaying] = useState(false);
  const lastPing = useRef(0);
  const leaving = useRef(false);
  /** The 12-hour notice, once acknowledged, does not come back. */
  const endSeen = useRef(false);

  const apply = useCallback((s: SessionState | null) => {
    if (!s) return;
    const skew = Date.now() - new Date(s.now).getTime();
    const active = new Date(s.lastActiveAt).getTime() + skew;
    lastPing.current = Math.max(lastPing.current, active);
    writeShared(lastPing.current);
    setState({ idleMs: s.idleMinutes === null ? null : s.idleMinutes * 60_000, expiresAt: new Date(s.expiresAt).getTime() + skew, skew });
  }, []);

  const leave = useCallback(async (reason: 'idle' | 'expired' | 'signed-out') => {
    if (leaving.current) return;
    leaving.current = true;
    await api.post('/auth/logout').catch(() => undefined);
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    reloadTo(reason === 'signed-out' ? '/login' : `/login?next=${next}&reason=${reason}`);
  }, []);

  const ping = useCallback(async () => {
    lastPing.current = Date.now();
    writeShared(lastPing.current);
    try {
      apply(await api.post<SessionState | null>('/me/activity'));
    } catch {
      // Offline or a limit reached: the next tap tries again. A sign-in that has ended is sent to sign in by api().
    }
  }, [apply]);

  // What this sign-in allows, once.
  useEffect(() => {
    let cancelled = false;
    api.get<SessionState | null>('/me/session').then((s) => { if (!cancelled) apply(s); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [apply]);

  // Real activity, sent at most once a minute; other tabs' activity counts too.
  useEffect(() => {
    if (!state) return;
    const onActivity = () => {
      if (leaving.current) return;
      if (Date.now() - Math.max(lastPing.current, readShared()) > PING_EVERY_MS) void ping();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHARED_KEY) lastPing.current = Math.max(lastPing.current, Number(event.newValue) || 0);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });
    window.addEventListener('storage', onStorage);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      window.removeEventListener('storage', onStorage);
    };
  }, [state, ping]);

  const warningOpen = warning !== null;
  // The countdown: checked every second while a warning shows, every 10 seconds otherwise, and on returning to the tab.
  useEffect(() => {
    if (!state) return;
    const check = () => {
      if (leaving.current) return;
      const now = Date.now();
      const last = Math.max(lastPing.current, readShared());
      const idleLeft = state.idleMs === null ? Infinity : last + state.idleMs - now;
      const endLeft = state.expiresAt - now;
      if (idleLeft <= 0) return void leave('idle');
      if (endLeft <= 0) return void leave('expired');
      if (idleLeft <= IDLE_WARNING_MS && idleLeft <= endLeft) setWarning({ kind: 'idle', left: idleLeft });
      else if (endLeft <= IDLE_WARNING_MS && !endSeen.current) setWarning({ kind: 'end', left: endLeft });
      else setWarning(null);
    };
    check();
    const timer = window.setInterval(check, warningOpen ? 1000 : 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state, warningOpen, leave]);

  const stay = async () => {
    setStaying(true);
    await ping();
    setStaying(false);
    setWarning(null);
  };

  if (!warning) return null;
  const idle = warning.kind === 'idle';
  return (
    <Modal
      open
      onClose={() => { if (idle) void stay(); else { endSeen.current = true; setWarning(null); } }}
      title={idle ? 'Are you still there?' : 'Your sign-in is ending'}
      description={idle
        ? 'For your security, SimeTown signs you out when you have been away for a while.'
        : 'A sign-in lasts up to 12 hours. Save what you are doing, then sign in again.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => void leave('signed-out')}><Text>Sign out</Text></Button>
          {idle
            ? <Button pending={staying} onClick={() => void stay()}><Text>Stay signed in</Text></Button>
            : <Button onClick={() => { endSeen.current = true; setWarning(null); }}><Text>OK</Text></Button>}
        </>
      }
    >
      <p role="timer" aria-live="off" className="flex items-center gap-3 text-[15px] text-ink-700">
        <Clock className="size-5 shrink-0 text-brand-600" aria-hidden />
        <span><Text>You will be signed out in</Text> <strong className="font-display text-xl tabular-nums text-ink-900">{clock(warning.left)}</strong></span>
      </p>
    </Modal>
  );
}
