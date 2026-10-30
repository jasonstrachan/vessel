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
    md: 'h-[28px] px-4 text-xs',
    lg: 'h-[32px] px-5 text-sm'
  };

  const variantClasses = {
    primary: 'vessel-button vessel-button-primary',
    secondary: 'vessel-button'
  };

  const baseClasses = 'transition-colors duration-100 whitespace-nowrap text-center disabled:opacity-50 disabled:cursor-not-allowed';
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