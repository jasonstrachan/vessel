'use client';

import React, { useState, useEffect } from 'react';

export default function FastRefreshIndicator() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [lastRefresh, setLastRefresh] = useState('');
  const [isVisible, setIsVisible] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setRefreshCount(prev => prev + 1);
    setLastRefresh(new Date().toLocaleTimeString());
    
    // Flash indicator on hot reload
    setIsReloading(true);
    const flashTimer = setTimeout(() => setIsReloading(false), 500);
    
    // Auto-hide after 3 seconds
    const hideTimer = setTimeout(() => setIsVisible(false), 3000);
    
    // Listen for build errors
    if (typeof window !== 'undefined') {
      const handleBuildError = () => {
        setIsVisible(true);
        setIsReloading(true);
      };
      
      window.addEventListener('error', handleBuildError);
      return () => {
        window.removeEventListener('error', handleBuildError);
        clearTimeout(flashTimer);
        clearTimeout(hideTimer);
      };
    }
    
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!isClient || (!isVisible && !isReloading)) {
    return null;
  }

  const bgColor = isReloading ? 'bg-yellow-600' : 'bg-green-600';
  const opacity = isVisible ? 'opacity-100' : 'opacity-0';

  return (
    <div 
      className={`fixed top-4 right-4 ${bgColor} text-white px-3 py-1 rounded-md text-xs shadow-lg transition-all duration-300 ${opacity} cursor-pointer`} 
      style={{ zIndex: 9999 }}
      onClick={() => setIsVisible(!isVisible)}
      title="Click to toggle visibility"
    >
      <div className="flex items-center gap-2">
        <span className={isReloading ? 'animate-spin' : ''}>
          {isReloading ? '⚡' : '✓'}
        </span>
        <span>
          Hot Reload: {refreshCount}x | {lastRefresh}
        </span>
      </div>
    </div>
  );
}