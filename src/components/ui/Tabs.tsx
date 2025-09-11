import React from 'react';

interface TabsProps {
  tabs: Array<{ label: string; value: string }>;
  activeTab: string;
  onTabChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onTabChange, className = '', size = 'md' }) => {
  const fontSize = size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px';
  return (
    <div className={`flex flex-wrap gap-0 ${className}`}>
      {tabs.map((tab, index) => {
        const isActive = tab.value === activeTab;
        const isFirst = index === 0;
        const isLast = index === tabs.length - 1;
        
        return (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={`
              px-2.5 h-[25px] transition-all duration-200
              ${isActive 
                ? 'bg-[#D9D9D9] text-[#31313A]' 
                : 'bg-[#4a4a4a] text-[#D9D9D9] hover:bg-[#555]'
              }
              ${!isFirst ? 'border-l border-[#555]' : ''}
            `}
            style={{ fontSize }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
