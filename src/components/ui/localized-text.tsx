'use client';

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { translate, useLang, usePlainLanguage } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n-core';

export function translateChildren(children: ReactNode, lang: Lang, plain = false): ReactNode {
  if (typeof children === 'string') return translate(lang, children, undefined, plain);
  if (Array.isArray(children)) return Children.map(children, child => translateChildren(child, lang, plain));
  // Fragments can contain mixed emphasis and text. Custom components own their own rendering.
  if (isValidElement<{ children?: ReactNode }>(children) && children.type === Fragment) return translateChildren(children.props.children, lang, plain);
  return children;
}

/** A text-only React boundary: updates with the language (and Simple Mode's plain wording) without changing DOM structure. */
export function Text({ children }: { children: ReactNode }) {
  return translateChildren(children, useLang(), usePlainLanguage());
}
