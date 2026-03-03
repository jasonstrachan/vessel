import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import GlobalErrorHooks from '../components/GlobalErrorHooks';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: 'vessel',
  description: 'Simple pixel art editor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={ibmPlexMono.variable}>
        <GlobalErrorBoundary>
          <GlobalErrorHooks />
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
