'use client';

import React, { useEffect, useState } from 'react';

interface FeedbackStripProps {
  message: string;
  duration?: number;
  onClose?: () => void;
}

const FeedbackStrip: React.FC<FeedbackStripProps> = ({ 
  message, 
  duration = 3000,
  onClose 
}) => {
  const [isVisible, setIsVisible] = useState(true);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onClose) {
        setTimeout(onClose, 300); // Wait for fade out animation
      }
    }, duration);
    
    return () => clearTimeout(timer);
  }, [duration, onClose]);
  
  if (!message) return null;
  
  return (
    <div
      className={`
        fixed bottom-5 left-1/2 transform -translate-x-1/2
        bg-black text-white px-4 py-2 rounded
        transition-opacity duration-300 z-50
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