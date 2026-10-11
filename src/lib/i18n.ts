'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { translateMessage } from './i18n-core';

/**
 * English and Bahasa Malaysia. English is the key: any text without a Malay
 * version simply shows in English, so personal content is preserved.
 */

export type Lang = 'en' | 'ms';
const KEY = 'kita.lang';
const listeners = new Set<() => void>();
let memoryLanguage: Lang = 'en';
let memoryOnly = false;
let revision = 0;
export const getLanguageRevision = () => revision;

function read(): Lang {
  if (memoryOnly) return memoryLanguage;
  try {
    return window.localStorage.getItem(KEY) === 'ms' ? 'ms' : 'en';
  } catch {
    return memoryLanguage;
  }
}

export function setLang(lang: Lang): void {
  memoryLanguage = lang;
  revision += 1;
  try {
    window.localStorage.setItem(KEY, lang);
    memoryOnly = false;
  } catch {
    // Private browsing may refuse storage; the choice then lasts for this page only.
    memoryOnly = true;
  }
  document.documentElement.lang = lang === 'ms' ? 'ms' : 'en';
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      revision += 1;
      memoryOnly = false;
      notify();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, read, () => 'en');
}

/** Translate one string. `{name}` placeholders are filled from `vars`. */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  return translateMessage(lang, text, vars);
}

export function useT() {
  const lang = useLang();
  return useCallback((text: string, vars?: Record<string, string | number>) => translate(lang, text, vars), [lang]);
}

/**
 * Reads text aloud with the browser's own voice (Akses+). Nothing is sent
 * anywhere. Returns false if the browser has no speech support.
 */
export function speak(text: string, lang: Lang): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(translate(lang, text));
  utterance.lang = lang === 'ms' ? 'ms-MY' : 'en-MY';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
  return true;
}
