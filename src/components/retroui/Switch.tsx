import React from 'react';

import CustomSwitch from '@/components/ui/CustomSwitch';

interface SwitchProps {
  id: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  'aria-label'?: string;
}

export const Switch: React.FC<SwitchProps> = ({ id, checked = false, onChange, 'aria-label': ariaLabel }) => (
  <CustomSwitch id={id} checked={checked} onChange={(value) => onChange?.(value)} aria-label={ariaLabel} />
);
