import type { Metadata } from 'next';
import './globals.css';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import GlobalErrorHooks from '../components/GlobalErrorHooks';

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
  return (
    <html lang="en">
      <body style={{ ['--font-ibm-plex-mono' as string]: '"Courier New", monospace' }}>
        <GlobalErrorBoundary>
          <GlobalErrorHooks />
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
