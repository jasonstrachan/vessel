'use client';

import { useEffect } from 'react';
import {
  getLastCrashReport,
  getLastHangReport,
  hasSeenCrashReport,
  hasSeenHangReport,
  logError,
  markCrashReportSeen,
  markHangReportSeen,
  getPersistedBreadcrumbs,
  persistCrashReport,
  persistHangReport,
  recordBreadcrumb,
} from '@/utils/debug';
import { getErrorMessage, getErrorStack } from '@/utils/errorMessage';

export default function GlobalErrorHooks() {
  useEffect(() => {
    const canPostRuntimeEvents = (() => {
      if (process.env.NODE_ENV === 'development') {
        return true;
      }

      if (typeof window === 'undefined') {
        return false;
      }

      const { protocol, hostname } = window.location;
      return protocol === 'http:' && (
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
      );
    })();
    const ACTIVE_SESSION_KEY = 'TB_ACTIVE_RUNTIME_SESSION';
    const HANG_GAP_MS = 4_000;
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
    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const readActiveSession = (): {
      sessionId?: string;
      href?: string;
      status?: string;
      visibilityState?: string | null;
      lastBeatAt?: number;
    } | null => {
      try {
        const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          return null;
        }
        return parsed as {
          sessionId?: string;
          href?: string;
          status?: string;
          visibilityState?: string | null;
          lastBeatAt?: number;
        };
      } catch {
        return null;
      }
    };

    const writeActiveSession = (status: 'active' | 'clean-exit') => {
      try {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({
          clientId,
          sessionId,
          href: window.location.href,
          visibilityState: document.visibilityState,
          status,
          lastBeatAt: Date.now(),
        }));
      } catch {}
    };

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
      if (!canPostRuntimeEvents) {
        return;
      }
      try {
        const body = JSON.stringify({
          ...payload,
          clientId,
          href: window.location.href,
          visibilityState: document.visibilityState,
          ts: Date.now(),
          userAgent: window.navigator.userAgent,
          breadcrumbs: payload.event === 'heartbeat' ? undefined : getPersistedBreadcrumbs(),
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

    const previousHang = getLastHangReport();
    if (previousHang && !hasSeenHangReport(previousHang)) {
      try {
        console.warn('[previous-hang]', {
          message: previousHang.message,
          href: previousHang.href,
          t: previousHang.t,
          gapMs: previousHang.gapMs ?? null,
          sessionId: previousHang.sessionId ?? null,
          breadcrumbs: previousHang.breadcrumbs.length,
        });
      } catch {}
      markHangReportSeen(previousHang);
    }

    const priorSession = readActiveSession();
    if (
      priorSession?.status === 'active' &&
      priorSession.sessionId &&
      priorSession.sessionId !== sessionId &&
      typeof priorSession.lastBeatAt === 'number'
    ) {
      const gapMs = Date.now() - priorSession.lastBeatAt;
      if (gapMs > HANG_GAP_MS) {
        const report = persistHangReport({
          message: 'Previous runtime session stopped heartbeating before a clean exit',
          sessionId: priorSession.sessionId,
          href: priorSession.href ?? window.location.href,
          visibilityState: priorSession.visibilityState ?? null,
          lastBeatAt: priorSession.lastBeatAt,
          gapMs,
        });
        if (report && !hasSeenHangReport(report)) {
          try {
            console.warn('[recovered-hang]', {
              message: report.message,
              href: report.href,
              gapMs: report.gapMs,
              sessionId: report.sessionId,
              breadcrumbs: report.breadcrumbs.length,
            });
          } catch {}
          markHangReportSeen(report);
        }
      }
    }

    writeActiveSession('active');

    const onError = (event: ErrorEvent) => {
      try {
        const message = getErrorMessage(event.error ?? event, event.message || 'Unknown error');
        const stack = getErrorStack(event.error ?? event);
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
        const message = getErrorMessage(reason, 'Unhandled promise rejection');
        const stack = getErrorStack(reason);
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
      writeActiveSession('active');
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
        persistHangReport({
          message: 'Recovered after event-loop lag spike',
          sessionId,
          visibilityState: document.visibilityState,
          lastBeatAt: now,
          gapMs: lagMs,
        });
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
            persistHangReport({
              message: `Recovered after long task: ${entry.name || 'longtask'}`,
              sessionId,
              visibilityState: document.visibilityState,
              lastBeatAt: Date.now(),
              gapMs: durationMs,
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

    const handleBeforeUnload = () => {
      writeActiveSession('clean-exit');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      if (lagTimer !== null) {
        window.clearInterval(lagTimer);
      }
      performanceObserver?.disconnect();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, []);
  return null;
}
