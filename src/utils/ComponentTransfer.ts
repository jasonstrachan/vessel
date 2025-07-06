import { BrushPreset, BrushComponent, ComponentType } from '@/types/brush';

/**
 * Component transfer utility for copying components between brushes
 */
export class ComponentTransfer {
  /**
   * Copy a component from one brush to another
   */
  static copyComponent(
    sourcePreset: BrushPreset,
    targetPreset: BrushPreset,
    componentType: ComponentType
  ): BrushPreset {
    const sourceComponent = sourcePreset.components.find(
      comp => comp.type === componentType
    );

    if (!sourceComponent) {
      throw new Error(`Source preset does not have component type: ${componentType}`);
    }

    // Create a deep copy of the source component with new ID
    const copiedComponent: BrushComponent = {
      ...sourceComponent,
      id: `${componentType.toLowerCase()}-${Date.now()}`,
      parameters: { ...sourceComponent.parameters }
    };

    // Remove existing component of the same type from target
    const filteredComponents = targetPreset.components.filter(
      comp => comp.type !== componentType
    );

    // Add the copied component
    const newComponents = [...filteredComponents, copiedComponent]
      .sort((a, b) => a.priority - b.priority);

    return {
      ...targetPreset,
      components: newComponents,
      modifiedAt: new Date()
    };
  }

  /**
   * Copy multiple components from one brush to another
   */
  static copyComponents(
    sourcePreset: BrushPreset,
    targetPreset: BrushPreset,
    componentTypes: ComponentType[]
  ): BrushPreset {
    let result = { ...targetPreset };

    for (const componentType of componentTypes) {
      result = ComponentTransfer.copyComponent(sourcePreset, result, componentType);
    }

    return result;
  }

  /**
   * Extract components of specific types from a brush
   */
  static extractComponents(
    preset: BrushPreset,
    componentTypes: ComponentType[]
  ): BrushComponent[] {
    return preset.components.filter(comp => 
      componentTypes.includes(comp.type)
    );
  }

  /**
   * Create a new brush preset with specific components
   */
  static createPresetWithComponents(
    baseName: string,
    components: BrushComponent[],
    category: string = 'Custom'
  ): BrushPreset {
    const sortedComponents = components
      .map(comp => ({
        ...comp,
        id: `${comp.type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      }))
      .sort((a, b) => a.priority - b.priority);

    return {
      id: `custom-${Date.now()}`,
      name: baseName,
      category,
      components: sortedComponents,
      thumbnail: '',
      tags: ['custom', 'transferred'],
      isFavorite: false,
      isDefault: false,
      createdAt: new Date(),
      modifiedAt: new Date()
    };
  }

  /**
   * Check if two components are compatible for transfer
   */
  static areComponentsCompatible(
    sourceComponent: BrushComponent,
    targetComponent: BrushComponent
  ): boolean {
    // Same type components are always compatible
    if (sourceComponent.type === targetComponent.type) {
      return true;
    }

    // Define compatibility rules between different component types
    const compatibilityRules: Partial<Record<ComponentType, ComponentType[]>> = {
      [ComponentType.SIZE_MODIFIER]: [ComponentType.PRESSURE_HANDLER],
      [ComponentType.PRESSURE_HANDLER]: [ComponentType.SIZE_MODIFIER, ComponentType.OPACITY_MODIFIER],
      [ComponentType.OPACITY_MODIFIER]: [ComponentType.PRESSURE_HANDLER],
      [ComponentType.ANTI_ALIASING]: [], // Generally standalone
      [ComponentType.PATTERN_RENDERER]: [], // Generally standalone
    };

    const compatibleTypes = compatibilityRules[sourceComponent.type] || [];
    return compatibleTypes.includes(targetComponent.type);
  }

  /**
   * Validate that a brush preset has required components
   */
  static validateBrushPreset(preset: BrushPreset): string[] {
    const errors: string[] = [];

    // Check for required components
    const requiredTypes = [ComponentType.SIZE_MODIFIER, ComponentType.ANTI_ALIASING];
    
    for (const requiredType of requiredTypes) {
      const hasComponent = preset.components.some(comp => comp.type === requiredType);
      if (!hasComponent) {
        errors.push(`Missing required component: ${requiredType}`);
      }
    }

    // Check for duplicate component types
    const componentTypes = preset.components.map(comp => comp.type);
    const duplicates = componentTypes.filter((type, index) => 
      componentTypes.indexOf(type) !== index
    );
    
    if (duplicates.length > 0) {
      errors.push(`Duplicate component types: ${duplicates.join(', ')}`);
    }

    return errors;
  }

  /**
   * Get suggested component transfers based on brush analysis
   */
  static getSuggestedTransfers(
    sourcePreset: BrushPreset,
    targetPreset: BrushPreset
  ): ComponentType[] {
    const suggestions: ComponentType[] = [];

    // Suggest transferring pressure settings if source has good pressure and target doesn't
    const sourcePressure = sourcePreset.components.find(c => c.type === ComponentType.PRESSURE_HANDLER);
    const targetPressure = targetPreset.components.find(c => c.type === ComponentType.PRESSURE_HANDLER);

    if (sourcePressure?.enabled && !targetPressure?.enabled) {
      suggestions.push(ComponentType.PRESSURE_HANDLER);
    }

    return suggestions;
  }
}

export default ComponentTransfer;