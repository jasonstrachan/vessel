import studioExtension from '@/extensions/studioExtension';

import ButtonGroup from '@/components/ui/ButtonGroup';

export type CcGradientModeValue = 'fg' | 'manual' | 'sample';

type CcGradientSourceModeControlProps = {
  value: CcGradientModeValue;
  onChange: (value: string) => void;
};

const CC_GRADIENT_SOURCE_OPTIONS = [
  { label: 'FG Grad', value: 'fg' },
  { label: 'Palette', value: 'manual' },
  { label: 'Sample', value: 'sample' },
];

export const CcGradientSourceModeControl = ({
  value,
  onChange,
}: CcGradientSourceModeControlProps) => {
  const SourceControls = studioExtension.ColorCycleSourceControls;
  return (
    <div className="mb-2 flex w-full min-w-0" role="group" aria-label="Colour source and effects">
      {SourceControls ? <SourceControls value={value} onChange={onChange} /> : <ButtonGroup
        options={CC_GRADIENT_SOURCE_OPTIONS}
        value={value}
        onChange={onChange}
        size="sm"
      />}
    </div>
  );
};
