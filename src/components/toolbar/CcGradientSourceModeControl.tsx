import ButtonGroup from '@/components/ui/ButtonGroup';

export type CcGradientModeValue = 'fg' | 'manual' | 'sample';

type CcGradientSourceModeControlProps = {
  value: CcGradientModeValue;
  onChange: (value: string) => void;
};

const CC_GRADIENT_SOURCE_OPTIONS = [
  { label: 'FG Grad', value: 'fg' },
  { label: 'Man Grad', value: 'manual' },
  { label: 'Sample', value: 'sample' },
];

export const CcGradientSourceModeControl = ({
  value,
  onChange,
}: CcGradientSourceModeControlProps) => (
  <div className="mb-2">
    <ButtonGroup
      options={CC_GRADIENT_SOURCE_OPTIONS}
      value={value}
      onChange={onChange}
      size="sm"
    />
  </div>
);
