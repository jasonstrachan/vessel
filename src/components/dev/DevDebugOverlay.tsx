'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CC_DEBUG, CC_DEBUG_STATE_EVENT } from '@/debug/ccDebug';
import {
  clearDevDebugOverlayEntries,
  DEV_DEBUG_OVERLAY_EVENT,
  isDevDebugOverlayEnabled,
  isDevDebugOverlayMinimized,
  readDevDebugOverlayEntries,
  setDevDebugOverlayMinimized,
  type DevDebugOverlayEntry,
} from '@/utils/dev/debugOverlayStore';

const formatTime = (ts: number): string => {
  const date = new Date(ts);
  return `${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`;
};

const levelClassName: Record<DevDebugOverlayEntry['level'], string> = {
  log: 'text-[#d9d9d9]',
  warn: 'text-[#ffb86b]',
  group: 'text-[#91c7ff]',
  assert: 'text-[#ff7a7a]',
};

const sourceClassName = (source: string): string => {
  if (source === 'cc') {
    return 'border-[#3f556d] bg-[#162433] text-[#9cc9ff]';
  }
  if (source === 'layer-activation') {
    return 'border-[#6c5a2c] bg-[#2e2412] text-[#ffd985]';
  }
  if (source === 'visible-composite') {
    return 'border-[#3c5c49] bg-[#14251c] text-[#9ee6bd]';
  }
  return 'border-[#4d4d4d] bg-[#1b1b1b] text-[#cfcfcf]';
};

const toClipboardText = (entries: DevDebugOverlayEntry[]): string =>
  entries.map((entry) => {
    const header = `[${formatTime(entry.ts)}] ${entry.source.toUpperCase()} ${entry.level.toUpperCase()} ${entry.message}`;
    return entry.data ? `${header}\n${entry.data}` : header;
  }).join('\n\n');

type CCDebugFlags = {
  on: boolean;
  verbose: boolean;
  timing: boolean;
};

const readCcDebugFlags = (): CCDebugFlags => ({
  on: CC_DEBUG.on,
  verbose: CC_DEBUG.verbose,
  timing: CC_DEBUG.timing,
});

const countEntriesBySource = (entries: DevDebugOverlayEntry[]) =>
  entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.source] = (acc[entry.source] ?? 0) + 1;
    return acc;
  }, {});

export default function DevDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [entries, setEntries] = useState<DevDebugOverlayEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [ccDebugFlags, setCcDebugFlags] = useState<CCDebugFlags>(readCcDebugFlags);

  useEffect(() => {
    const refresh = () => {
      const on = isDevDebugOverlayEnabled();
      setEnabled(on);
      setMinimized(isDevDebugOverlayMinimized());
      setCcDebugFlags(readCcDebugFlags());
      if (!on) {
        setEntries([]);
        return;
      }
      setEntries(readDevDebugOverlayEntries());
    };

    refresh();
    const handleOverlayUpdate = () => refresh();
    window.addEventListener(DEV_DEBUG_OVERLAY_EVENT, handleOverlayUpdate);
    window.addEventListener(CC_DEBUG_STATE_EVENT, handleOverlayUpdate);
    window.addEventListener('storage', handleOverlayUpdate);

    return () => {
      window.removeEventListener(DEV_DEBUG_OVERLAY_EVENT, handleOverlayUpdate);
      window.removeEventListener(CC_DEBUG_STATE_EVENT, handleOverlayUpdate);
      window.removeEventListener('storage', handleOverlayUpdate);
    };
  }, []);

  const visibleEntries = useMemo(() => entries.slice(-60), [entries]);
  const sourceCounts = useMemo(() => countEntriesBySource(entries), [entries]);

  if (!enabled) {
    return null;
  }

  const copyEntries = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(toClipboardText(entries));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const toggleCcDebugFlag = (key: keyof CCDebugFlags) => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextValue = !ccDebugFlags[key];
    if (key === 'on') {
      window.__CC_DEBUG__ = nextValue;
      return;
    }
    if (key === 'verbose') {
      (window as Window & { __CC_DEBUG_VERBOSE__?: boolean }).__CC_DEBUG_VERBOSE__ = nextValue;
      return;
    }
    (window as Window & { __CC_DEBUG_TIMING__?: boolean }).__CC_DEBUG_TIMING__ = nextValue;
  };

  const controlButtonClassName = (active: boolean) =>
    `rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
      active
        ? 'border-[#4f7db0] bg-[#1e3a57] text-[#d7ebff]'
        : 'border-[#4a4a4a] text-[#d9d9d9] hover:bg-white/10'
    }`;

  return (
    <div
      className="fixed right-[532px] top-2 bottom-2 z-[80] flex w-[380px] max-w-[calc(100vw-548px)] flex-col rounded border border-[#3b3b3b] bg-black/85 text-[11px] shadow-2xl"
      style={{ pointerEvents: 'auto' }}
      aria-label="dev-debug-overlay"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="shrink-0 whitespace-nowrap">Dev Debug Overlay</span>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[9px] tracking-[0.12em] text-[#6f6f6f]">
            {Object.entries(sourceCounts).length === 0 ? (
              <span className="truncate">no sources yet</span>
            ) : (
              Object.entries(sourceCounts).map(([source, count]) => (
                <span key={source} className={`shrink-0 rounded border px-1.5 py-[1px] ${sourceClassName(source)}`}>
                  {source}:{count}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleCcDebugFlag('on')}
            className={controlButtonClassName(ccDebugFlags.on)}
          >
            cc
          </button>
          <button
            type="button"
            onClick={() => toggleCcDebugFlag('verbose')}
            className={controlButtonClassName(ccDebugFlags.verbose)}
          >
            verbose
          </button>
          <button
            type="button"
            onClick={() => toggleCcDebugFlag('timing')}
            className={controlButtonClassName(ccDebugFlags.timing)}
          >
            timing
          </button>
          <button
            type="button"
            onClick={() => void copyEntries()}
            className="rounded border border-[#4a4a4a] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#d9d9d9] hover:bg-white/10"
          >
            {copied ? 'copied' : 'copy all'}
          </button>
          <button
            type="button"
            onClick={() => clearDevDebugOverlayEntries()}
            className="rounded border border-[#4a4a4a] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#d9d9d9] hover:bg-white/10"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => setDevDebugOverlayMinimized(!minimized)}
            className="rounded border border-[#4a4a4a] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#d9d9d9] hover:bg-white/10"
          >
            {minimized ? 'expand' : 'minimize'}
          </button>
        </div>
      </div>
      {minimized ? null : (
        <div
          data-testid="dev-debug-overlay-scroll-region"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 font-mono leading-[1.2]"
        >
          {visibleEntries.length === 0 ? (
            <div className="text-[#6f6f6f]">Waiting for debug events...</div>
          ) : (
            visibleEntries.map((entry) => (
              <div key={entry.id} className="mb-1.5 border-b border-white/5 pb-1.5 last:mb-0 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-1.5 text-[#7f7f7f] leading-[1.15]">
                  <span>{formatTime(entry.ts)}</span>
                  <span className={`rounded border px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em] ${sourceClassName(entry.source)}`}>
                    {entry.source}
                  </span>
                  <span className={levelClassName[entry.level]}>{entry.message}</span>
                </div>
                {entry.data ? (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[#a8a8a8] leading-[1.15]">
                    {entry.data}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
