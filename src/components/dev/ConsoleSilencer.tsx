'use client';

import { useEffect } from 'react';

export default function ConsoleSilencer() {
  useEffect(() => {
    try {
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
