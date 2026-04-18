'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  clearDevDebugOverlayEntries,
  DEV_DEBUG_OVERLAY_EVENT,
  isDevDebugOverlayEnabled,
  readDevDebugOverlayEntries,
  setDevDebugOverlayEnabled,
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
  return 'border-[#4d4d4d] bg-[#1b1b1b] text-[#cfcfcf]';
};

const toClipboardText = (entries: DevDebugOverlayEntry[]): string =>
  entries.map((entry) => {
    const header = `[${formatTime(entry.ts)}] ${entry.source.toUpperCase()} ${entry.level.toUpperCase()} ${entry.message}`;
    return entry.data ? `${header}\n${entry.data}` : header;
  }).join('\n\n');

export default function DevDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<DevDebugOverlayEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const on = isDevDebugOverlayEnabled();
      setEnabled(on);
      if (!on) {
        setEntries([]);
        return;
      }
      setEntries(readDevDebugOverlayEntries());
    };

    refresh();
    const intervalId = window.setInterval(refresh, 500);
    const handleOverlayUpdate = () => refresh();
    window.addEventListener(DEV_DEBUG_OVERLAY_EVENT, handleOverlayUpdate);
    window.addEventListener('storage', handleOverlayUpdate);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(DEV_DEBUG_OVERLAY_EVENT, handleOverlayUpdate);
      window.removeEventListener('storage', handleOverlayUpdate);
    };
  }, []);

  const visibleEntries = useMemo(() => entries.slice(-24), [entries]);

  if (!enabled) {
    return null;
  }

  const copyEntries = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(toClipboardText(visibleEntries));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="fixed right-[532px] top-2 z-[80] w-[380px] max-w-[calc(100vw-548px)] rounded border border-[#3b3b3b] bg-black/85 text-[11px] shadow-2xl"
      style={{ pointerEvents: 'auto' }}
      aria-label="dev-debug-overlay"
    >
      <div className="flex items-center justify-between border-b border-[#2a2a2a] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">
        <span>Dev Debug Overlay</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyEntries()}
            className="rounded border border-[#4a4a4a] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#d9d9d9] hover:bg-white/10"
          >
            {copied ? 'copied' : 'copy'}
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
            onClick={() => setDevDebugOverlayEnabled(false)}
            className="rounded border border-[#4a4a4a] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#d9d9d9] hover:bg-white/10"
          >
            hide
          </button>
        </div>
      </div>
      <div className="max-h-[42vh] overflow-hidden px-3 py-2 font-mono leading-4">
        {visibleEntries.length === 0 ? (
          <div className="text-[#6f6f6f]">Waiting for debug events...</div>
        ) : (
          visibleEntries.map((entry) => (
            <div key={entry.id} className="mb-2 border-b border-white/5 pb-2 last:mb-0 last:border-b-0 last:pb-0">
              <div className="flex items-center gap-2 text-[#7f7f7f]">
                <span>{formatTime(entry.ts)}</span>
                <span className={`rounded border px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em] ${sourceClassName(entry.source)}`}>
                  {entry.source}
                </span>
                <span className={levelClassName[entry.level]}>{entry.message}</span>
              </div>
              {entry.data ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-[#a8a8a8]">
                  {entry.data}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
