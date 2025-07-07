import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TinyBrush v3',
  description: 'Simple pixel art editor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
