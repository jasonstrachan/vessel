import type { BrushSettings } from '@/types';

export const PATTERN_STYLES: { value: NonNullable<BrushSettings['patternStyle']>; label: string }[] = [
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Diagonal Lines' },
  { value: 'vertical-lines', label: 'Vertical Lines' },
  { value: 'horizontal-lines', label: 'Horizontal Lines' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'diagonal', label: 'Diamond' },
  { value: 'ascii', label: 'ASCII Cells' },
  { value: 'tone-adaptive', label: 'Tone Adaptive' },
];
