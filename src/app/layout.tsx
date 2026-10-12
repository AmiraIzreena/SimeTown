
import { Text } from '@/components/ui/localized-text';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { LanguageProvider } from '@/components/ui/language';


//changes the name from 'SimeTown' to SimeTown
export const metadata: Metadata = { 
  title: { default: 'SimeTown · Township App for all', template: '%s · SimeTown' },
  description: 'One app for township life: recycle, move, report, share and shop locally, with rewards that are always paid for first.',
  robots: { index: false }, // a prototype with demo data should not be indexed
};

//changes color to match Sime Darby primary color
export const viewport: Viewport = { themeColor: '#dc8010', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the per-request nonce keeps every page dynamically rendered, which the strict CSP needs (see src/proxy.ts).
  await headers();
  return (
    <html lang="en">
      <body>
        <LanguageProvider><ToastProvider><Text>{children}</Text></ToastProvider></LanguageProvider>
      </body>
    </html>
  );
}
