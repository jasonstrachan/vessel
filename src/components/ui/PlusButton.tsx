import React from 'react';
import { Plus } from 'lucide-react';

interface PlusButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'icon' | 'text';
  size?: 'small' | 'medium';
}

const PlusButton: React.FC<PlusButtonProps> = ({ 
  variant = 'text', 
  size = 'small',
  className = '',
  ...props 
}) => {
  const sizeClasses = {
    small: 'w-5 h-5',
    medium: 'w-6 h-6'
  };

  const baseClasses = `${sizeClasses[size]} flex items-center justify-center transition-colors`;

  if (variant === 'icon') {
    return (
      <button
        className={`${baseClasses} text-[#5A5A61] hover:text-[#888888] ${className}`}
        {...props}
      >
        <Plus size={16} />
      </button>
    );
  }

  // text variant (default)
  return (
    <button
      className={`${baseClasses} border border-white text-[#D9D9D9] hover:bg-white hover:text-[#31313A] ${className}`}
      style={{ fontSize: '14px' }}
      {...props}
    >
      +
    </button>
  );
};

export default PlusButton;