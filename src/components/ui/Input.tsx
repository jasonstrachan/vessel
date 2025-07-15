import React, { forwardRef, useRef, useState, useCallback, useEffect } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'hex' | 'compact';
  fullWidth?: boolean;
  dragSensitivity?: number;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', variant = 'default', fullWidth = false, type = 'text', dragSensitivity = 1, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;

    const dragState = useRef({
      isDragging: false,
      startY: 0,
      startValue: 0
    });

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      if (type !== 'number') return;
      
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      
      dragState.current = {
        isDragging: true,
        startY: e.clientY,
        startValue: parseFloat(inputRef.current?.value || '0')
      };
    }, [type]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      if (!dragState.current.isDragging) return;
      
      const deltaY = dragState.current.startY - e.clientY;
      const newValue = dragState.current.startValue + (deltaY * dragSensitivity);
      
      if (inputRef.current) {
        const min = parseFloat(inputRef.current.min || '-Infinity');
        const max = parseFloat(inputRef.current.max || 'Infinity');
        const clampedValue = Math.min(Math.max(newValue, min), max);
        
        // Only update the visual value, no expensive state updates during drag
        inputRef.current.value = Math.round(clampedValue).toString();
      }
    }, [dragSensitivity]);

    const handlePointerUp = useCallback(() => {
      if (!dragState.current.isDragging) return;
      
      dragState.current.isDragging = false;
      
      // Commit the final value to parent component's state
      if (onChange && inputRef.current) {
        const event = { target: inputRef.current } as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      }
    }, [onChange]);

    // Base classes for all inputs
    const baseClasses = 'bg-[#404040] border border-[#555] text-[#D9D9D9] focus:outline-none focus:ring-1 focus:ring-blue-500 touch-none';
    
    // Variant-specific classes
    const variantClasses = {
      default: 'px-2 py-1 text-base',
      hex: 'px-2 py-1 text-base font-mono uppercase',
      compact: 'px-1 py-1 text-base text-center'
    };

    // Type-specific classes
    const typeClasses = {
      number: 'text-center',
      range: 'appearance-none cursor-pointer slider h-2',
      checkbox: 'w-4 h-4 cursor-pointer',
      color: 'w-8 h-8 cursor-pointer p-0'
    };

    // Width classes
    const widthClasses = fullWidth ? 'w-full' : '';

    // Combine all classes
    const combinedClasses = [
      baseClasses,
      variantClasses[variant],
      typeClasses[type as keyof typeof typeClasses] || '',
      widthClasses,
      className
    ].filter(Boolean).join(' ');

    const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
      // Prevent virtual keyboard for stylus/pen input
      if (e.nativeEvent.detail === 0) {
        e.target.blur();
      }
    }, []);

    return (
      <input
        ref={inputRef}
        type={type}
        className={combinedClasses}
        suppressHydrationWarning
        inputMode="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onChange={onChange}
        onFocus={handleFocus}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;