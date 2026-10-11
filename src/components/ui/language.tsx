'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Languages } from 'lucide-react';
import { api } from '@/lib/api';
import { getLanguageRevision, setLang, useLang } from '@/lib/i18n';

let pendingSave: Promise<unknown> = Promise.resolve();
/** Serialize writes so a quick EN→BM→EN switch cannot leave the account in BM. */
export function persistLanguage(language: 'en' | 'ms') {
  pendingSave = pendingSave.catch(() => undefined).then(() => api.post('/me/language', { language }));
  return pendingSave;
}

export function LanguageSwitch({ signedIn = false }: { signedIn?: boolean }) {
  const lang = useLang();
  return (
    <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-brand-800 shadow-xs" aria-label={lang === 'ms' ? 'Switch to English' : 'Tukar ke Bahasa Malaysia'} onClick={() => {
      const next = lang === 'ms' ? 'en' : 'ms';
      setLang(next);
      if (signedIn) void persistLanguage(next).catch(() => undefined);
    }}>
      <Languages className="size-4" aria-hidden />
      <span>{lang === 'ms' ? 'BM' : 'EN'}</span>
    </button>
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const pathname = usePathname();
  const signedArea = /^\/(app|console|merchant|sponsor|guard)(\/|$)/.test(pathname);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <>{children}{!signedArea && <div className="no-print fixed bottom-4 right-4 z-50"><LanguageSwitch /></div>}</>;
}

/** Restore the account preference, unless the person has just switched it themselves. */
export function AccountLanguage() {
  useEffect(() => {
    let active = true;
    const revision = getLanguageRevision();
    void api.get<{ language: 'en' | 'ms' }>('/me').then((me) => {
      if (active && revision === getLanguageRevision() && (me.language === 'en' || me.language === 'ms')) setLang(me.language);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return null;
}
