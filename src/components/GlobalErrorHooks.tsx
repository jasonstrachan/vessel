'use client';

import { useEffect } from 'react';
import {
  getLastCrashReport,
  hasSeenCrashReport,
  logError,
  markCrashReportSeen,
  getPersistedBreadcrumbs,
  persistCrashReport,
  recordBreadcrumb,
} from '@/utils/debug';

export default function GlobalErrorHooks() {
  useEffect(() => {
    const clientId = (() => {
      try {
        const key = 'TB_RUNTIME_CLIENT_ID';
        const existing = window.sessionStorage.getItem(key);
        if (existing) {
          return existing;
        }
        const nextId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(key, nextId);
        return nextId;
      } catch {
        return `ephemeral-${Date.now().toString(36)}`;
      }
    })();

    const postRuntimeEvent = (payload: {
      event: 'crash' | 'heartbeat' | 'longtask' | 'lag';
      type?: 'error' | 'unhandledrejection';
      message: string;
      durationMs?: number | null;
      lagMs?: number | null;
      stack?: string | null;
      filename?: string | null;
      lineno?: number | null;
      colno?: number | null;
    }) => {
      try {
        const body = JSON.stringify({
          ...payload,
          clientId,
          href: window.location.href,
          visibilityState: document.visibilityState,
          ts: Date.now(),
          userAgent: window.navigator.userAgent,
          breadcrumbs: payload.event === 'crash' ? getPersistedBreadcrumbs() : undefined,
        });

        if (typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon('/api/client-error', blob);
          return;
        }

        void fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      } catch {}
    };

    const previousCrash = getLastCrashReport();
    if (previousCrash && !hasSeenCrashReport(previousCrash)) {
      try {
        console.warn('[previous-crash]', {
          type: previousCrash.type,
          message: previousCrash.message,
          href: previousCrash.href,
          t: previousCrash.t,
          breadcrumbs: previousCrash.breadcrumbs.length,
        });
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
        postRuntimeEvent({
          event: 'crash',
          type: 'error',
          message,
          stack,
          filename: event.filename ?? null,
          lineno: event.lineno ?? null,
          colno: event.colno ?? null,
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
        postRuntimeEvent({
          event: 'crash',
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

    let heartbeatTimer: number | null = null;
    let lagTimer: number | null = null;
    let performanceObserver: PerformanceObserver | null = null;

    const sendHeartbeat = () => {
      postRuntimeEvent({
        event: 'heartbeat',
        message: 'heartbeat',
      });
    };

    sendHeartbeat();
    heartbeatTimer = window.setInterval(sendHeartbeat, 5000);

    let expectedTick = Date.now() + 1000;
    lagTimer = window.setInterval(() => {
      const now = Date.now();
      const lagMs = now - expectedTick;
      expectedTick = now + 1000;
      if (lagMs > 1500) {
        recordBreadcrumb('client-runtime-lag', { lagMs });
        postRuntimeEvent({
          event: 'lag',
          message: 'event-loop-lag',
          lagMs,
        });
      }
    }, 1000);

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        performanceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const durationMs = entry.duration;
            if (!Number.isFinite(durationMs) || durationMs < 200) {
              continue;
            }
            recordBreadcrumb('client-runtime-longtask', {
              durationMs,
              name: entry.name,
              entryType: entry.entryType,
            });
            postRuntimeEvent({
              event: 'longtask',
              message: entry.name || 'longtask',
              durationMs,
            });
          }
        });
        performanceObserver.observe({ entryTypes: ['longtask'] });
      } catch {}
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      if (lagTimer !== null) {
        window.clearInterval(lagTimer);
      }
      performanceObserver?.disconnect();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
