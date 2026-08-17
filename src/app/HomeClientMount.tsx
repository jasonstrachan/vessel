'use client';

import React from 'react';

import { preloadHistoryRehydrationModule } from '@/history/historyManager';
import { BrushEngineProvider } from '@/hooks/BrushEngineProvider';
import { initializeAppStoreRuntime } from '@/stores/useAppStore';
import { startLocalPatternLibraryAutoSync } from '@/utils/ditherPatterns/localPatternAutoSync';

import HomeClient from './HomeClient';

export default function HomeClientMount() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    initializeAppStoreRuntime();
    setMounted(true);
    void preloadHistoryRehydrationModule();
    return startLocalPatternLibraryAutoSync();
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <BrushEngineProvider>
      <HomeClient />
    </BrushEngineProvider>
  );
}
