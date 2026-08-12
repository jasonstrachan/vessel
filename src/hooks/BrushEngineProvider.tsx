'use client';

import React, { createContext, useContext } from 'react';

import {
  type BrushEngine,
  useBrushEngineSimplified,
} from '@/hooks/useBrushEngineSimplified';

const BrushEngineContext = createContext<BrushEngine | null>(null);

export const BrushEngineProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const brushEngine = useBrushEngineSimplified();

  return (
    <BrushEngineContext.Provider value={brushEngine}>
      {children}
    </BrushEngineContext.Provider>
  );
};

export const useBrushEngine = (): BrushEngine => {
  const brushEngine = useContext(BrushEngineContext);
  if (!brushEngine) {
    throw new Error('useBrushEngine must be used within BrushEngineProvider');
  }
  return brushEngine;
};
