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
      ? 'bg-red-700/95 border-red-500/70'
      : phase === 'saved'
        ? 'bg-emerald-800/95 border-emerald-500/70'
        : 'bg-black/90 border-[#3B3B3B]';

  return (
    <div
      className={`fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border px-3 py-1 text-[12px] text-white shadow-lg pointer-events-none select-none ${bgClass}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
};

export default React.memo(SaveStatusStrip);
