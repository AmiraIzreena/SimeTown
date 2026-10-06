import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: { default: 'KITA+ · Township Super-App', template: '%s · KITA+' },
  description: 'One app for township life: recycle, move, report, share and shop locally, with rewards that are always paid for first.',
  robots: { index: false }, // a prototype with demo data should not be indexed
};

export const viewport: Viewport = { themeColor: '#083433', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the per-request nonce keeps every page dynamically rendered, which the strict CSP needs (see src/proxy.ts).
  await headers();
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
