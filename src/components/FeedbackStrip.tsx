'use client';

import React, { useEffect, useState } from 'react';

const DEFAULT_FEEDBACK_DURATION_MS = 1200;
const FEEDBACK_FADE_MS = 150;

interface FeedbackStripProps {
  message: string;
  duration?: number;
  onClose?: () => void;
}

const FeedbackStrip: React.FC<FeedbackStripProps> = ({ 
  message, 
  duration = DEFAULT_FEEDBACK_DURATION_MS,
  onClose 
}) => {
  const [isVisible, setIsVisible] = useState(true);
  
  useEffect(() => {
    setIsVisible(true);
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onClose) {
        fadeTimer = setTimeout(onClose, FEEDBACK_FADE_MS);
      }
    }, duration);
    
    return () => {
      clearTimeout(timer);
      if (fadeTimer) {
        clearTimeout(fadeTimer);
      }
    };
  }, [duration, message, onClose]);
  
  if (!message) return null;
  
  return (
    <div
      className={`
        fixed bottom-5 left-1/2 transform -translate-x-1/2
        bg-black text-white px-4 py-2 rounded
        transition-opacity duration-150 z-50
        ${isVisible ? 'opacity-100' : 'opacity-0'}
        pointer-events-none select-none
      `}
      style={{
        fontSize: '14px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
      }}
    >
      {message}
    </div>
  );
};

export default React.memo(FeedbackStrip);
