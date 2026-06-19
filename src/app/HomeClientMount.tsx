'use client';

import React from 'react';
import { preloadHistoryRehydrationModule } from '@/history/historyManager';
import { initializeAppStoreRuntime } from '@/stores/useAppStore';
import HomeClient from './HomeClient';

export default function HomeClientMount() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    initializeAppStoreRuntime();
    setMounted(true);
    void preloadHistoryRehydrationModule();
  }, []);

  if (!mounted) {
    return null;
  }

  return <HomeClient />;
}
