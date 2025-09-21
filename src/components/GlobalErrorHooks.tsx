'use client';

import { useEffect } from 'react';

export default function GlobalErrorHooks() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      try {
        console.error('[global-error]', event.message, event.error || '(no error object)');
      } catch {}
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      try {
        console.error('[global-unhandled-rejection]', event.reason);
      } catch {}
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
