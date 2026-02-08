import {
  createColorCycleBrushEraserSettingsGetter,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';

type ColorCycleBrushEraserSettingsGetterArgs = Parameters<typeof createColorCycleBrushEraserSettingsGetter>[0];

export const buildColorCycleBrushEraserSettingsGetterArgs = (
  args: ColorCycleBrushEraserSettingsGetterArgs
): ColorCycleBrushEraserSettingsGetterArgs => args;
