'use client';

import { useEffect, useState } from 'react';

/** Draws a QR code. The generator is loaded only when a code is actually shown. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode').then(async (qr) => {
      const url = await qr.toDataURL(value, { width: size * 2, margin: 1, color: { dark: '#083433', light: '#ffffff' } });
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [value, size]);
  if (!src) return <div aria-hidden className="skeleton rounded-lg" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element -- a generated data URL; the image optimiser adds nothing here
  return <img src={src} width={size} height={size} alt={label} className="rounded-lg border border-ink-200" />;
}
