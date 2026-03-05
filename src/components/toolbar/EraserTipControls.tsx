import React from 'react';
import ButtonGroup from '@/components/ui/ButtonGroup';
import type { EraserTipOption } from '@/stores/helpers/eraserSettings';

type EraserTipControlsProps = {
  value: EraserTipOption;
  onChange: (value: EraserTipOption) => void;
};

const EraserTipControls: React.FC<EraserTipControlsProps> = ({ value, onChange }) => {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
          Tip
        </label>
        <ButtonGroup
          options={[
            { label: 'Square', value: 'square' },
            { label: 'Round', value: 'round' },
            { label: 'Diamond5', value: 'diamond5' },
          ]}
          value={value}
          onChange={(next) => onChange(next as EraserTipOption)}
          size="sm"
          className="flex-1"
        />
      </div>
    </div>
  );
};

export default EraserTipControls;
