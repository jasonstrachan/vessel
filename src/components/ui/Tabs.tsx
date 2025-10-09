"use client";

import React, { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TabsProps {
  tabs: Array<{ label: string; value: string }>;
  activeTab: string;
  onTabChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const ACCENT_COLOR = '#D9D9D9';
type RowMeta = {
  isRowStart: boolean;
  isFirstRow: boolean;
};

const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange, className = '', size = 'md' }) => {
  const fontSize = size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px';
  const containerRef = useRef<HTMLDivElement>(null);
  const [rowMeta, setRowMeta] = useState<RowMeta[]>([]);
  const rowMetaRef = useRef<RowMeta[]>([]);

  const recomputeLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const nextMeta: RowMeta[] = [];
    let previousTop: number | null = null;
    let firstRowTop: number | null = null;

    buttons.forEach((button) => {
      const top = button.offsetTop;

      if (firstRowTop === null) {
        firstRowTop = top;
      }

      const isRowStart = previousTop === null || top > (previousTop + 0.5);
      const isFirstRow = Math.abs(top - firstRowTop) <= 0.5;

      nextMeta.push({ isRowStart, isFirstRow });
      previousTop = top;
    });

    const didChange =
      nextMeta.length !== rowMetaRef.current.length ||
      nextMeta.some((meta, index) => {
        const previous = rowMetaRef.current[index];
        if (!previous) return true;
        return previous.isRowStart !== meta.isRowStart || previous.isFirstRow !== meta.isFirstRow;
      });

    if (didChange) {
      rowMetaRef.current = nextMeta;
      setRowMeta(nextMeta);
    }
  }, []);

  useLayoutEffect(() => {
    recomputeLayout();
  }, [recomputeLayout, tabs, size, activeTab]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        recomputeLayout();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', recomputeLayout);
    return () => window.removeEventListener('resize', recomputeLayout);
  }, [recomputeLayout]);

  return (
    <div ref={containerRef} className={`flex flex-wrap ${className}`}>
      {tabs.map((tab, index) => {
        const isActive = tab.value === activeTab;
        const layout = rowMeta[index] ?? { isRowStart: index === 0, isFirstRow: true };

        const style: CSSProperties = {
          fontSize,
          borderColor: isActive ? ACCENT_COLOR : '#d9d9d9',
          color: isActive ? '#1A1A1A' : '#d9d9d9',
          backgroundColor: isActive ? '#F2F2F2' : 'transparent',
          marginLeft: !layout.isRowStart ? '-1px' : undefined,
          marginTop: !layout.isFirstRow ? '-1px' : undefined,
          borderLeftWidth: !layout.isRowStart ? 0 : undefined,
          borderTopWidth: !layout.isFirstRow ? 0 : undefined,
          zIndex: isActive ? 1 : undefined
        };

        if (isActive) {
          style.outline = '1px solid #f2f2f2';
          style.outlineOffset = '-1px';
        }

        return (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={`
              px-2.5 h-[25px] transition-all duration-200 border bg-transparent
              ${isActive ? 'font-semibold' : 'hover:text-[#F3F3F7] hover:border-[#F3F3F7]'}
            `}
            style={style}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
