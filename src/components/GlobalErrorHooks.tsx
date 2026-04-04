'use client';

import { useEffect } from 'react';
import {
  getLastCrashReport,
  hasSeenCrashReport,
  logError,
  markCrashReportSeen,
  persistCrashReport,
  recordBreadcrumb,
} from '@/utils/debug';

export default function GlobalErrorHooks() {
  useEffect(() => {
    const previousCrash = getLastCrashReport();
    if (previousCrash && !hasSeenCrashReport(previousCrash)) {
      try {
        logError('[previous-crash]', previousCrash);
      } catch {}
      markCrashReportSeen(previousCrash);
    }

    const onError = (event: ErrorEvent) => {
      try {
        const message = event.message || 'Unknown error';
        const stack =
          typeof event.error?.stack === 'string'
            ? event.error.stack
            : (typeof event.error === 'string' ? event.error : null);
        recordBreadcrumb('global-error', {
          message,
          filename: event.filename ?? null,
          lineno: event.lineno ?? null,
          colno: event.colno ?? null,
        });
        const report = persistCrashReport({
          type: 'error',
          message,
          stack,
        });
        logError('[global-error]', message, event.error || '(no error object)');
        if (report) {
          logError('[global-error-report]', report);
        }
      } catch {}
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      try {
        const reason = event.reason;
        const message =
          typeof reason?.message === 'string'
            ? reason.message
            : (typeof reason === 'string' ? reason : 'Unhandled promise rejection');
        const stack =
          typeof reason?.stack === 'string'
            ? reason.stack
            : null;
        recordBreadcrumb('global-unhandled-rejection', {
          message,
          reason,
        });
        const report = persistCrashReport({
          type: 'unhandledrejection',
          message,
          stack,
        });
        logError('[global-unhandled-rejection]', reason);
        if (report) {
          logError('[global-unhandled-rejection-report]', report);
        }
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
