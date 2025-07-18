// Subtle autosave indicator for TinyBrush
// Shows autosave status and last save time

import React, { useState, useEffect } from 'react';
import { useAutosave } from '../../utils/autosave';

export default function AutosaveIndicator() {
  const { isEnabled, hasUnsavedChanges, lastSaveTime } = useAutosave();
  const [isVisible, setIsVisible] = useState(false);
  const [displayText, setDisplayText] = useState('');

  useEffect(() => {
    if (!isEnabled) {
      setIsVisible(false);
      return;
    }

    // Only show indicator when auto-saved, not for unsaved changes
    if (lastSaveTime && !hasUnsavedChanges) {
      setDisplayText('Auto-saved');
      setIsVisible(true);
      
      // Hide the indicator after 3 seconds
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 3000);
      
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isEnabled, hasUnsavedChanges, lastSaveTime]);

  const formatLastSaveTime = (time: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - time.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) {
      return 'just now';
    } else if (diffMinutes === 1) {
      return '1 minute ago';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minutes ago`;
    } else {
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours === 1) {
        return '1 hour ago';
      } else {
        return `${diffHours} hours ago`;
      }
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg px-3 py-2 shadow-lg">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="text-green-300">
            {displayText}
            {lastSaveTime && (
              <span className="text-gray-400 ml-1">
                {formatLastSaveTime(lastSaveTime)}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}