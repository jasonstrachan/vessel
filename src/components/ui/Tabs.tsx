import React, { CSSProperties } from 'react';

interface TabsProps {
  tabs: Array<{ label: string; value: string }>;
  activeTab: string;
  onTabChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const ACCENT_COLOR = '#D9D9D9';
const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange, className = '', size = 'md' }) => {
  const fontSize = size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px';

  return (
    <div className={`flex flex-wrap ${className}`}>
      {tabs.map((tab, index) => {
        const isActive = tab.value === activeTab;

        const style: CSSProperties = {
          fontSize,
          borderColor: ACCENT_COLOR,
          color: isActive ? ACCENT_COLOR : 'rgba(217, 217, 217, 0.7)',
          backgroundColor: 'transparent'
        };

        if (isActive) {
          Object.assign(style, {
            backgroundImage: 'var(--ascii-slider-pattern-image)',
            backgroundSize: 'var(--ascii-slider-pattern-base-size) var(--ascii-slider-pattern-base-size)',
            backgroundRepeat: 'repeat'
          });
        }

        return (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={`
              px-2.5 h-[25px] transition-all duration-200 border bg-transparent
              ${index === 0 ? '' : '-ml-px border-l-0'}
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
