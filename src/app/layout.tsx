import type { Metadata } from 'next';
import './globals.css';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import GlobalErrorHooks from '../components/GlobalErrorHooks';
import {
  createTxtShapeFontFaceCss,
  TXT_SHAPE_FONT_DEFINITIONS,
} from '@/utils/txtShapeFonts';

export const metadata: Metadata = {
  title: 'Vessel',
  description: 'Browser drawing workspace for layered artwork, custom brushes, color-cycle animation, and Goblet exports.',
  icons: {
    icon: `${process.env.VESSEL_BASE_PATH ?? ''}/favicon.ico`,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const basePath = process.env.VESSEL_BASE_PATH ?? '';
  const bundledFonts = TXT_SHAPE_FONT_DEFINITIONS.filter((font) => font.asset);

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: createTxtShapeFontFaceCss(basePath) }} />
        {bundledFonts.map((font) => (
          <link
            key={font.family}
            rel="preload"
            href={`${basePath}/assets/fonts/${font.asset!.fileName}`}
            as="font"
            type={font.asset!.format === 'woff2' ? 'font/woff2' : 'font/otf'}
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body style={{ ['--font-ibm-plex-mono' as string]: '"Courier New", monospace' }}>
        <GlobalErrorBoundary>
          <GlobalErrorHooks />
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
