import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  ...props 
}) => {
  const sizeClasses = {
    sm: 'h-[20px] px-3 text-sm',
    md: 'h-[25px] px-4 text-base',
    lg: 'h-[30px] px-5 text-lg'
  };

  const variantClasses = {
    primary: 'bg-[#D9D9D9] border-2 border-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] hover:text-[#31313A]',
    secondary: 'bg-transparent border-2 border-[#888] text-[#D9D9D9] hover:bg-[#555] hover:border-[#999]'
  };

  const baseClasses = 'transition-all duration-300 whitespace-nowrap text-center disabled:opacity-50 disabled:cursor-not-allowed';
  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${widthClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;