'use client';

// Adapted from Spell UI "Blur Reveal" (spell.sh/r/blur-reveal): letters fade in
// from a soft blur. Changes: several styled segments in one element, text is
// translated with the current language, and reduced-motion users get the text
// without any animation.

import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties, JSX } from 'react';
import { translate, useLang } from '@/lib/i18n';

export interface BlurRevealSegment {
  text: string;
  className?: string;
  /** Glue this segment to the previous word (no space, no line break), e.g. a full stop. */
  attach?: boolean;
}

export interface BlurRevealProps {
  segments: BlurRevealSegment[];
  className?: string;
  style?: CSSProperties;
  as?: keyof JSX.IntrinsicElements;
  /** Delay before the reveal starts, in seconds. */
  delay?: number;
  /** Higher is a quicker sweep across the letters. */
  speedReveal?: number;
  /** Higher is a quicker fade for each letter. */
  speedSegment?: number;
  inView?: boolean;
}

type Piece = { text: string; className?: string };

export function BlurReveal({
  segments,
  className,
  style,
  as = 'p',
  delay = 0,
  speedReveal = 1.5,
  speedSegment = 0.5,
  inView = false,
}: BlurRevealProps) {
  const lang = useLang();
  const reduceMotion = useReducedMotion();

  const translated = segments.map(segment => ({ ...segment, text: translate(lang, segment.text) }));
  const fullText = translated.map(s => (s.attach ? s.text : ` ${s.text}`)).join('').trim();

  // Each word is a list of pieces so one word can mix colours ("together" + ".").
  const words: Piece[][] = [];
  for (const segment of translated) {
    const parts = segment.text.split(/\s+/).filter(Boolean);
    parts.forEach((part, index) => {
      const piece = { text: part, className: segment.className };
      const previous = words.at(-1);
      if (index === 0 && segment.attach && previous) previous.push(piece);
      else words.push([piece]);
    });
  }

  const Tag = as as 'p';
  if (reduceMotion) {
    return (
      <Tag className={className} style={style}>
        {words.map((word, wordIndex) => (
          <span key={wordIndex}>
            {word.map((piece, pieceIndex) => <span key={pieceIndex} className={piece.className}>{piece.text}</span>)}
            {wordIndex < words.length - 1 ? ' ' : null}
          </span>
        ))}
      </Tag>
    );
  }

  const MotionTag = motion[as as keyof typeof motion] as typeof motion.p;
  const stagger = 0.03 / speedReveal;
  const duration = 0.3 / speedSegment;

  const container = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: stagger, delayChildren: delay } },
  };
  const letter = {
    hidden: { opacity: 0, filter: 'blur(12px)', y: 10 },
    visible: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { duration, ease: 'easeOut' as const } },
  };

  return (
    <MotionTag
      key={lang}
      initial="hidden"
      animate={inView ? undefined : 'visible'}
      whileInView={inView ? 'visible' : undefined}
      viewport={{ once: true }}
      variants={container}
      className={className}
      style={style}
    >
      <span className="sr-only">{fullText}</span>
      {words.map((word, wordIndex) => (
        <span key={wordIndex} aria-hidden="true" className="inline-block whitespace-nowrap">
          {word.map((piece, pieceIndex) => (
            <span key={pieceIndex} className={piece.className}>
              {Array.from(piece.text).map((char, charIndex) => (
                <motion.span key={charIndex} variants={letter} className="inline-block">{char}</motion.span>
              ))}
            </span>
          ))}
          {wordIndex < words.length - 1 && <motion.span variants={letter} className="inline-block">{' '}</motion.span>}
        </span>
      ))}
    </MotionTag>
  );
}
