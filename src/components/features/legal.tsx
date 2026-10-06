import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';
import { LEGAL } from '@/shared/legal';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** A readable legal document: title, version, a short summary, contents, numbered sections. */
export function LegalDocument({ title, summary, sections, other }: { title: string; summary: ReactNode; sections: LegalSection[]; other: { href: string; label: string } }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-ink-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" aria-label="KITA+ home" className="rounded-md">
            <Logo />
          </Link>
          <Link href={other.href} className="text-sm font-semibold text-brand-700 hover:underline">
            {other.label}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl font-bold sm:text-[34px]">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">
          Effective {LEGAL.effectiveDate} · Version {LEGAL.version}
        </p>
        <div className="mt-6 rounded-lg border border-brand-200 bg-brand-50 p-5 text-[15px] leading-relaxed text-brand-900">{summary}</div>
        <nav aria-label="Contents" className="mt-8 rounded-lg border border-ink-200 p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-500">Contents</p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-brand-700 hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-6">
              <h2 className="text-xl font-bold text-ink-900">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-700">{s.body}</div>
            </section>
          ))}
        </div>
        <footer className="mt-14 border-t border-ink-200 pt-6 text-sm text-ink-500">
          <p>
            Questions about this document: <a href={`mailto:${LEGAL.contactEmail}`} className="font-semibold text-brand-700 hover:underline">{LEGAL.contactEmail}</a>
          </p>
          <p className="mt-2">KITA+ is a student prototype for the Sime Darby Property University Hackathon 2026. It is not an official Sime Darby Property product.</p>
        </footer>
      </main>
    </div>
  );
}

/** A bulleted list with the document's spacing. */
export const Bullets = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-400">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);
