'use client';

import dynamic from 'next/dynamic';

const DrawingCanvas = dynamic(() => import('./DrawingCanvas').then(mod => ({ default: mod.DrawingCanvas })), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-gray-900">
      <div className="text-white">Loading canvas...</div>
    </div>
  ),
});

export default DrawingCanvas;