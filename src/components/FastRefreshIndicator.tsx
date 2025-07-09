'use client';

import React, { useState, useEffect } from 'react';

export default function FastRefreshIndicator() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [lastRefresh, setLastRefresh] = useState('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setRefreshCount(prev => prev + 1);
    setLastRefresh(new Date().toLocaleTimeString());
  }, []);

  if (!isClient) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 bg-green-600 text-white px-3 py-1 rounded-md text-xs shadow-lg" style={{ zIndex: 9999 }}>
      🔄 Fast Refresh: {refreshCount} | {lastRefresh}
    </div>
  );
}