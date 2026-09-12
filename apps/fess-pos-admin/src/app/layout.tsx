import type { Metadata } from 'next';
import { Inter, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { EnvBanner } from '@/components/shell/env-banner';
import { PREFS_BOOTSTRAP_SCRIPT } from '@/lib/preferences-script';
import './globals.css';

// Admin UI font: Inter — a screen-first typeface, very legible in dense tables (D-47). Self-hosted by next/font.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// FESS's typeface (schema/design/tokens.json → font), used only inside the phone preview so it looks like the FESS app.
// Not preloaded: it downloads only on pages that show a phone.
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-montserrat', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: { default: 'FESS POS Admin', template: '%s · FESS POS Admin' },
  description: 'FESS POS verification — administration panel',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script sets data-text-size on <html> before React hydrates.
    <html lang="en" className={`${inter.variable} ${montserrat.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <EnvBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
