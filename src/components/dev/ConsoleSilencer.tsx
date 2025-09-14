'use client';

import { useEffect } from 'react';

export default function ConsoleSilencer() {
  useEffect(() => {
    try {
      // Silence console only in production or when explicitly forced.
      const isProd = process.env.NODE_ENV === 'production';
      let forceSilence = false;
      try {
        // Allow opt-in silence in dev via localStorage
        forceSilence = typeof window !== 'undefined' && window.localStorage?.getItem('TB_SILENCE') === '1';
      } catch {}
      if (!isProd && !forceSilence) return; // Do not silence in dev by default

      // No-op console logging in the client runtime
      // Keep console.error intact for surfaced errors
      // eslint-disable-next-line no-console
      console.log = () => {};
      // eslint-disable-next-line no-console
      console.warn = () => {};
      // Optionally silence info/debug if used
      // eslint-disable-next-line no-console
      if ('info' in console) console.info = (..._args: any[]) => {};
      // eslint-disable-next-line no-console
      if ('debug' in console) console.debug = (..._args: any[]) => {};
    } catch {}
  }, []);
  return null;
}
