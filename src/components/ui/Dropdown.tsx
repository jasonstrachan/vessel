import React, { useState, useRef, useEffect } from 'react';

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
}

const Dropdown: React.FC<DropdownProps> = ({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className = "",
  renderOption,
  onAction,
  renderValue
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Find the current selected option
  const selectedOption = options.find(opt => opt.value === value);
  
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
  
  const handleSelect = (optionValue: string, isAction?: boolean) => {
    if (isAction && onAction) {
      onAction(optionValue);
      setIsOpen(false);
    } else if (!isAction) {
      onChange(optionValue);
      setIsOpen(false);
    }
  };
  
  const closeDropdown = () => {
    setIsOpen(false);
  };
  
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
        <div className="absolute z-50 w-full mt-1 bg-[#1A1A1A] border border-[#d9d9d9] shadow-lg">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                onClick={() => {
                  // Let the click handler work unless explicitly stopped
                  handleSelect(option.value, option.isAction);
                }}
                className={`w-full px-2 py-1 text-xs text-left transition-colors outline-none focus:outline-none cursor-pointer ${
                  option.isAction 
                    ? 'text-[#D9D9D9] hover:bg-[#555]'
                    : isSelected
                      ? 'bg-[#555] text-[#D9D9D9]'
                      : 'text-[#D9D9D9] hover:bg-[#555]'
                }`}
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
