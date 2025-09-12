import type { Metadata } from 'next';
import './globals.css';
import GlobalErrorBoundary from '../components/GlobalErrorBoundary';
import GlobalErrorHooks from '../components/GlobalErrorHooks';

export const metadata: Metadata = {
  title: 'tinybrush',
  description: 'Simple pixel art editor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <GlobalErrorBoundary>
          <GlobalErrorHooks />
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
