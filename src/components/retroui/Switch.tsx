import React from 'react';

interface SwitchProps {
  id: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Switch: React.FC<SwitchProps> = ({ id, checked = false, onChange }) => {
  return (
    <div className="relative inline-block">
      <input
        type="checkbox"
        name={id}
        id={id}
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only"
      />
      <label
        htmlFor={id}
        className="block w-[40px] h-[25px] border-2 border-white cursor-pointer"
      >
        <span
          className={`block w-[14px] h-[15px] bg-[#D9D9D9] border-2 border-black transition-transform duration-200 ${
            checked ? 'transform translate-x-[20px]' : 'transform translate-x-[2px]'
          } mt-[3px]`}
        />
      </label>
    </div>
  );
};