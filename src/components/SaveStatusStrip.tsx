'use client';

import React from 'react';

interface SaveStatusStripProps {
  phase: 'idle' | 'saving' | 'saved' | 'error';
  message: string | null;
}

const SaveStatusStrip: React.FC<SaveStatusStripProps> = ({ phase, message }) => {
  if (phase === 'idle') {
    return null;
  }

  const bgClass =
    phase === 'error'
      ? 'bg-[var(--vessel-panel)] border-red-400 text-red-200'
      : 'bg-[var(--vessel-panel)] border-[var(--vessel-border)] text-[var(--vessel-text)]';

  return (
    <div
      className={`absolute bottom-3 right-3 z-50 border px-3 py-2 text-[11px] pointer-events-none select-none ${bgClass}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-save-phase={phase}
    >
      {message}
    </div>
  );
};

export default React.memo(SaveStatusStrip);
