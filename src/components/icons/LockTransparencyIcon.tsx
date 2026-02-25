'use client';

import React, { useId, useMemo } from 'react';

export interface LockTransparencyIconProps {
  locked: boolean;
  size?: number;
  className?: string;
}

const LockTransparencyIcon: React.FC<LockTransparencyIconProps> = ({
  locked,
  size = 18,
  className
}) => {
  const baseId = useId();
  const patternId = useMemo(() => `${baseId}-checker`, [baseId]);

  const {
    strokeColor,
    borderColor,
    checkerPrimary,
    checkerSecondary,
    bodyFill,
    keyholeFill
  } = useMemo(() => {
    if (locked) {
      return {
        strokeColor: '#F8D866',
        borderColor: '#F8D866',
        checkerPrimary: '#4C4C4C',
        checkerSecondary: '#6B6B6B',
        bodyFill: '#F8D866',
        keyholeFill: '#1C1C1C'
      };
    }
    return {
      strokeColor: '#B8B8B8',
      borderColor: '#505050',
      checkerPrimary: '#2A2A2A',
      checkerSecondary: '#3B3B3B',
      bodyFill: '#1F1F1F',
      keyholeFill: '#B8B8B8'
    };
  }, [locked]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
        >
          <rect width="4" height="4" fill={checkerPrimary} />
          <rect width="2" height="2" fill={checkerSecondary} />
          <rect x="2" y="2" width="2" height="2" fill={checkerSecondary} />
        </pattern>
      </defs>
      <rect
        x="1"
        y="3"
        width="18"
        height="12"
        rx="2.5"
        fill={`url(#${patternId})`}
        stroke={borderColor}
        strokeWidth="1"
      />
      <path
        d="M7 9V7c0-2.2 1.8-4 4-4s4 1.8 4 4v2"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect
        x="6.2"
        y="9"
        width="7.6"
        height="6"
        rx="2.4"
        fill={bodyFill}
        stroke={strokeColor}
        strokeWidth="1.2"
      />
      <circle cx="10" cy="11.9" r="1.1" fill={keyholeFill} />
    </svg>
  );
};

export default React.memo(LockTransparencyIcon);
