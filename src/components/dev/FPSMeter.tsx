'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * FPSMeter - Lightweight on-screen FPS indicator
 * - Fixed bottom-left overlay
 * - Colors: green > 60, orange 30-60, red < 30
 */
export default function FPSMeter() {
  const rafId = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);
  const accTime = useRef(0);
  const frames = useRef(0);
  const lastUpdate = useRef(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const loop = (ts: number) => {
      if (lastTs.current == null) {
        lastTs.current = ts;
      }
      const dt = ts - (lastTs.current || ts);
      lastTs.current = ts;

      // accumulate frames and time
      accTime.current += dt;
      frames.current += 1;

      // update display every ~250ms to avoid re-rendering every RAF
      if (ts - lastUpdate.current >= 250 && accTime.current > 0) {
        const currentFps = (frames.current / accTime.current) * 1000;
        setFps(Math.round(currentFps));
        frames.current = 0;
        accTime.current = 0;
        lastUpdate.current = ts;
      }

      rafId.current = requestAnimationFrame(loop);
    };

    rafId.current = requestAnimationFrame(loop);
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const colorClass = fps > 60 ? 'bg-green-600/80' : fps >= 30 ? 'bg-orange-500/80' : 'bg-red-600/80';

  return (
    <div
      className={`fixed bottom-2 left-2 z-50 ${colorClass} text-white rounded px-2 py-1 text-xs font-medium shadow-lg select-none pointer-events-none`}
      aria-label="frames-per-second-indicator"
      title="Frames per second"
    >
      {fps} FPS
    </div>
  );
}

