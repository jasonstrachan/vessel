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
      console.log = () => undefined;
      console.warn = () => undefined;
      // Optionally silence info/debug if used
      if ('info' in console) console.info = () => undefined;
      if ('debug' in console) console.debug = () => undefined;
    } catch {}
  }, []);
  return null;
}
