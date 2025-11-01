import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const INTERACTIVE_SELECTOR = 'button, [role="button"], input, textarea, select, a[href], [data-dropdown-interactive="true"]';

const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
};

const DRAG_THRESHOLD = 4;

type DragState = {
  optionIndex: number;
  reorderableSlot: number;
  reorderableIndices: number[];
  pointerId: number;
  startY: number;
  currentY: number;
  hasMoved: boolean;
};

interface DropdownOption {
  value: string;
  label: string;
  isAction?: boolean;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  renderOption?: (option: DropdownOption, isSelected: boolean, onClose: () => void) => React.ReactNode;
  onAction?: (action: string) => void;
  renderValue?: (option: DropdownOption | null) => React.ReactNode;
  reorderable?: boolean;
  canReorderOption?: (option: DropdownOption) => boolean;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

const Dropdown: React.FC<DropdownProps> = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  renderOption,
  onAction,
  renderValue,
  reorderable = false,
  canReorderOption,
  onReorder
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragTargetSlot, setDragTargetSlot] = useState<number | null>(null);

  // Find the current selected option
  const selectedOption = options.find(opt => opt.value === value);

  const isOptionReorderable = useCallback((option: DropdownOption) => {
    if (!reorderable || !onReorder) {
      return false;
    }
    if (option.isAction) {
      return false;
    }
    if (canReorderOption && !canReorderOption(option)) {
      return false;
    }
    return true;
  }, [reorderable, onReorder, canReorderOption]);

  const getReorderableIndices = useCallback(() => {
    if (!reorderable || !onReorder) {
      return [] as number[];
    }
    return options.reduce<number[]>((acc, option, index) => {
      if (isOptionReorderable(option)) {
        acc.push(index);
      }
      return acc;
    }, []);
  }, [options, reorderable, onReorder, isOptionReorderable]);

  const computeTargetSlot = useCallback((pointerY: number, state: DragState): number => {
    const otherIndices = state.reorderableIndices.filter(index => index !== state.optionIndex);
    if (otherIndices.length === 0) {
      return 0;
    }

    let slot = otherIndices.length;
    for (let i = 0; i < otherIndices.length; i++) {
      const optionIndex = otherIndices[i];
      const element = optionRefs.current[optionIndex];
      if (!element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (pointerY < midpoint) {
        slot = i;
        break;
      }
    }

    return slot;
  }, []);

  const resetDragState = useCallback(() => {
    setDragState(null);
    setDragTargetSlot(null);
  }, []);

  const handleSelect = useCallback((optionValue: string, isAction?: boolean) => {
    if (isAction && onAction) {
      onAction(optionValue);
      setIsOpen(false);
    } else if (!isAction) {
      onChange(optionValue);
      setIsOpen(false);
    }
  }, [onAction, onChange]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handlePointerDown = useCallback((option: DropdownOption, optionIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (isInteractiveTarget(event.target)) {
      return;
    }

    if (!isOptionReorderable(option)) {
      return;
    }

    const reorderableIndices = getReorderableIndices();
    if (reorderableIndices.length < 2) {
      return;
    }

    const reorderableSlot = reorderableIndices.indexOf(optionIndex);
    if (reorderableSlot === -1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture errors (e.g., Safari)
    }

    setDragState({
      optionIndex,
      reorderableSlot,
      reorderableIndices,
      pointerId: event.pointerId,
      startY: event.clientY,
      currentY: event.clientY,
      hasMoved: false,
    });
    setDragTargetSlot(reorderableSlot);
  }, [getReorderableIndices, isOptionReorderable]);

  const handlePointerMove = useCallback((optionIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.optionIndex !== optionIndex) {
      return;
    }

    const pointerY = event.clientY;
    event.preventDefault();

    setDragState(prev => {
      if (!prev || prev.optionIndex !== optionIndex) {
        return prev;
      }
      const deltaY = pointerY - prev.startY;
      const hasMoved = prev.hasMoved || Math.abs(deltaY) > DRAG_THRESHOLD;
      const nextState: DragState = {
        ...prev,
        currentY: pointerY,
        hasMoved,
      };
      if (hasMoved) {
        const slot = computeTargetSlot(pointerY, nextState);
        setDragTargetSlot(slot);
      }
      return nextState;
    });
  }, [dragState, computeTargetSlot]);

  const completeReorder = useCallback((option: DropdownOption, targetSlot: number | null) => {
    if (!dragState) {
      return;
    }

    const finalSlot = targetSlot ?? dragState.reorderableSlot;
    if (dragState.hasMoved && onReorder && finalSlot !== dragState.reorderableSlot) {
      onReorder(dragState.reorderableSlot, finalSlot);
    }

    if (!dragState.hasMoved) {
      handleSelect(option.value, option.isAction);
    }

    resetDragState();
  }, [dragState, onReorder, handleSelect, resetDragState]);

  const handlePointerUp = useCallback((option: DropdownOption, optionIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (isInteractiveTarget(event.target)) {
      return;
    }

    if (dragState && dragState.optionIndex === optionIndex) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(dragState.pointerId);
      } catch {
        // Ignore errors if pointer capture was not set
      }
      event.preventDefault();
      completeReorder(option, dragTargetSlot);
      return;
    }

    handleSelect(option.value, option.isAction);
  }, [dragState, dragTargetSlot, completeReorder, handleSelect]);

  const handlePointerCancel = useCallback((optionIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.optionIndex !== optionIndex) {
      return;
    }

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(dragState.pointerId);
    } catch {
      // ignore
    }
    resetDragState();
  }, [dragState, resetDragState]);

const dropIndicator = useMemo(() => {
    if (!dragState || dragTargetSlot === null) {
      return null as null | { index: number; position: 'before' | 'after' };
    }

    const otherIndices = dragState.reorderableIndices.filter(index => index !== dragState.optionIndex);
    if (otherIndices.length === 0) {
      return null;
    }

    if (dragTargetSlot >= otherIndices.length) {
      const lastIndex = otherIndices[otherIndices.length - 1];
      return { index: lastIndex, position: 'after' as const };
    }

    const targetIndex = otherIndices[Math.max(0, dragTargetSlot)];
    return { index: targetIndex, position: 'before' as const };
  }, [dragState, dragTargetSlot]);

  optionRefs.current.length = options.length;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!dragState) {
      return;
    }
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragState]);

  useEffect(() => {
    if (!isOpen && dragState) {
      setDragState(null);
      setDragTargetSlot(null);
    }
  }, [isOpen, dragState]);
  
  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Dropdown trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-transparent border border-[#d9d9d9] text-[#D9D9D9] px-2 py-1 text-xs outline-none focus:outline-none flex items-center justify-between"
      >
        <span className="flex-1 min-w-0 mr-2">
          {renderValue ? renderValue(selectedOption || null) : (selectedOption ? selectedOption.label : placeholder)}
        </span>
        <svg
          className={`w-3 h-3 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute z-50 w-full mt-1 bg-[#1A1A1A] border border-[#d9d9d9] shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isDraggingOption = dragState?.optionIndex === index;
            const dragOffset = isDraggingOption && dragState?.hasMoved
              ? dragState.currentY - dragState.startY
              : 0;
            const isReorderable = isOptionReorderable(option);

            const dropBefore = dropIndicator && dropIndicator.index === index && dropIndicator.position === 'before';
            const dropAfter = dropIndicator && dropIndicator.index === index && dropIndicator.position === 'after';

            return (
              <div
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                onPointerDown={handlePointerDown(option, index)}
                onPointerMove={handlePointerMove(index)}
                onPointerUp={handlePointerUp(option, index)}
                onPointerCancel={handlePointerCancel(index)}
                className={`relative w-full px-2 py-1 text-xs text-left transition-colors outline-none focus:outline-none cursor-pointer select-none ${
                  option.isAction
                    ? 'text-[#D9D9D9] hover:bg-[#555]'
                    : isSelected
                      ? 'bg-[#555] text-[#D9D9D9]'
                      : 'text-[#D9D9D9] hover:bg-[#555]'
                } ${isDraggingOption ? 'z-10 shadow-lg bg-[#3a3a3a]' : ''} ${dropBefore ? 'border-t border-[#5E96FF]' : ''} ${dropAfter ? 'border-b border-[#5E96FF]' : ''}`}
                style={isDraggingOption ? { transform: `translateY(${dragOffset}px)` } : undefined}
                role="menuitem"
                aria-selected={isSelected}
                data-draggable={isReorderable ? 'true' : 'false'}
              >
                {renderOption ? renderOption(option, isSelected, closeDropdown) : option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
