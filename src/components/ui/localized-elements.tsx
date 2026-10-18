'use client';

import { createElement, type ComponentPropsWithRef, type JSX } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';

/** Localizes only presentation attributes; values, URLs, handlers and refs pass through unchanged. */
function localized<K extends keyof JSX.IntrinsicElements>(tag: K) {
  function LocalizedElement(props: ComponentPropsWithRef<K>) {
    const t = useT();
    const translated = { ...props } as Record<string, unknown>;
    for (const key of ['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'data-label']) {
      if (typeof translated[key] === 'string') translated[key] = t(translated[key]);
    }
    return createElement(tag, translated);
  }
  return LocalizedElement;
}

export const LocalizedAside = localized('aside');
export const LocalizedButton = localized('button');
export const LocalizedDialog = localized('dialog');
export const LocalizedDiv = localized('div');
export const LocalizedImg = localized('img');
export const LocalizedInput = localized('input');
export const LocalizedNav = localized('nav');
export const LocalizedSelect = localized('select');
export const LocalizedSvg = localized('svg');
export const LocalizedTextarea = localized('textarea');
export const LocalizedTd = localized('td');
export const LocalizedUl = localized('ul');

export function LocalizedLink(props: ComponentPropsWithRef<typeof Link>) {
  const t = useT();
  return <Link {...props} title={props.title ? t(props.title) : undefined} aria-label={props['aria-label'] ? t(props['aria-label']) : undefined} />;
}
