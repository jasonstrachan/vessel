import React, { forwardRef, useRef, useCallback, useState, useEffect } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'hex' | 'compact';
  fullWidth?: boolean;
  dragSensitivity?: number;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', variant = 'default', fullWidth = false, type = 'text', dragSensitivity = 1, onChange, value, onBlur, ...props }, ref) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;
    
    useEffect(() => {
      if (inputRef.current && String(value || '') !== inputRef.current.value) {
        inputRef.current.value = String(value || '');
      }
    }, [value]);

    const dragState = useRef({
      isDragging: false,
      pointerDown: false,
      startY: 0,
      startX: 0,
      startValue: 0
    });

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      if (type !== 'number') return;
      
      // Store initial position for drag threshold
      dragState.current = {
        isDragging: false,
        pointerDown: true,
        startY: e.clientY,
        startX: e.clientX,
        startValue: 0
      };
    }, [type]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      if (type !== 'number' || !dragState.current.pointerDown) return;
      
      const thresholdY = Math.abs(dragState.current.startY - e.clientY);
      const thresholdX = Math.abs(dragState.current.startX - e.clientX);
      const threshold = 3; // pixels
      
      // If not dragging yet, check if we've moved enough to start drag
      if (!dragState.current.isDragging && (thresholdY > threshold || thresholdX > threshold)) {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        
        // Get starting value, using min attribute if field is empty
        const currentValue = inputRef.current?.value || '';
        const min = parseFloat(inputRef.current?.min || '1');
        const startValue = currentValue === '' ? min : parseFloat(currentValue);
        
        dragState.current.isDragging = true;
        dragState.current.startValue = isNaN(startValue) ? min : startValue;
        
        // Set initial value if field was empty
        if (inputRef.current && currentValue === '') {
          inputRef.current.value = Math.round(dragState.current.startValue).toString();
        }
      }
      
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
    }, [dragSensitivity, type]);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      if (!dragState.current.pointerDown) return;
      
      const wasDragging = dragState.current.isDragging;
      
      // Release pointer capture if we were dragging
      if (wasDragging) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      
      dragState.current.isDragging = false;
      dragState.current.pointerDown = false;
      
      // Commit the final value to parent component's state only if we were dragging
      if (wasDragging && onChange && inputRef.current) {
        const event = { target: inputRef.current } as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      }
    }, [onChange]);

    // Base classes for all inputs
    const baseClasses = 'border-2 border-[#D9D9D9] text-[#D9D9D9] focus:outline-none focus:border-[#88888A] transition-colors touch-none';
    
    // Variant-specific classes
    const variantClasses = {
      default: 'px-2 h-[25px] text-base',
      hex: 'px-2 h-[25px] text-base font-mono uppercase',
      compact: 'px-1 h-[25px] text-base text-center'
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
      // Prevent virtual keyboard for stylus/pen input on non-number inputs
      if (type !== 'number' && e.nativeEvent.detail === 0) {
        // Reset drag state when blurring due to stylus
        dragState.current.isDragging = false;
        dragState.current.pointerDown = false;
        e.target.blur();
      }
    }, [type]);

    return (
      <input
        ref={inputRef}
        type={type}
        className={combinedClasses}
        suppressHydrationWarning
        inputMode={type === 'number' ? 'numeric' : 'none'}
        readOnly={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onChange={onChange}
        value={value}
        onFocus={handleFocus}
        onBlur={onBlur}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;