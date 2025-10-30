import { BrushPreset, BrushShape, ComponentType, CustomBrush } from '@/types';

interface CustomBrushPresetOptions {
  isDefault?: boolean;
}

export function createCustomBrushPreset(
  brush: CustomBrush,
  options: CustomBrushPresetOptions = {}
): BrushPreset {
  return {
    id: `custom_${brush.id}`,
    name: brush.name,
    category: 'Custom',
    components: [
      {
        id: 'custom-shape-renderer',
        type: ComponentType.SHAPE_RENDERER,
        parameters: {
          shape: BrushShape.CUSTOM
        },
        priority: 40,
        enabled: true
      }
    ],
    thumbnail: brush.thumbnail,
    tags: ['custom', 'loaded'],
    isDefault: Boolean(options.isDefault),
    createdAt: new Date(brush.createdAt),
    modifiedAt: new Date(brush.createdAt),
    isCustomBrush: true,
    customBrushData: {
      imageData: brush.imageData,
      width: brush.width,
      height: brush.height
    }
  };
}
