'use client';

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { useLang } from '@/lib/i18n';
import { translateMessage, type Lang } from '@/lib/i18n-core';

export function translateChildren(children: ReactNode, lang: Lang): ReactNode {
  if (typeof children === 'string') return translateMessage(lang, children);
  if (Array.isArray(children)) return Children.map(children, child => translateChildren(child, lang));
  // Fragments can contain mixed emphasis and text. Custom components own their own rendering.
  if (isValidElement<{ children?: ReactNode }>(children) && children.type === Fragment) return translateChildren(children.props.children, lang);
  return children;
}

/** A text-only React boundary: updates with the language without changing DOM structure. */
export function Text({ children }: { children: ReactNode }) {
  return translateChildren(children, useLang());
}
