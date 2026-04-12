'use client';

import React from 'react';

type DimensionsBoxProps = {
  label: string;
  width: number;
  height: number;
  className?: string;
};

const DimensionsBox: React.FC<DimensionsBoxProps> = ({
  label,
  width,
  height,
  className = '',
}) => {
  return (
    <div
      className={`rounded border border-[#2F2F2F] bg-[#181818] px-3 py-2 text-[#E2E8F0] ${className}`.trim()}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8F9BAD]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-sm font-medium leading-none">{width}×{height}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[#64748B]">px</span>
      </div>
    </div>
  );
};

export default React.memo(DimensionsBox);
