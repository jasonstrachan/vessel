'use client';

import { useRef, useCallback, useMemo, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { CanvasIntegration } from '@/engine/CanvasIntegration';
import { StrokeInputFactory } from '@/utils/StrokeInputFactory';
import { BrushPreset, ComponentType, SpacingParams } from '@/types/brush';
import { DEFAULT_BRUSH_PRESETS } from '@/engine/presets/DefaultBrushes';

/**
 * useBrushEngine - Hook for managing modular brush engine integration
 * Provides interface between React components and the modular brush system
 */
export const useBrushEngine = () => {
  const { 
    brushSettings, 
    selectedBrushPreset, 
    brushLibrary,
    setBrushSettings,
    setBrushLibraryState,
    loadBrushLibraryFromStorage
  } = useAppStore();
  
  // Engine instances (created once and reused)
  const canvasIntegration = useRef<CanvasIntegration>(new CanvasIntegration());
  const strokeInputFactory = useRef<StrokeInputFactory>(new StrokeInputFactory());
  
  // Track the last preset we synced to prevent infinite loops
  const lastSyncedPreset = useRef<string | null>(null);

  // Initialize brush library with default brushes and load from storage
  useEffect(() => {
    // Load saved state from localStorage first
    loadBrushLibraryFromStorage();
  }, [loadBrushLibraryFromStorage]);
  
  // Initialize with default brushes if empty (separate effect to avoid dependencies)
  useEffect(() => {
    if (brushLibrary.brushes.length === 0) {
      const defaultFavorites = DEFAULT_BRUSH_PRESETS
        .filter(brush => brush.isFavorite)
        .map(brush => brush.id);
        
      setBrushLibraryState({
        brushes: DEFAULT_BRUSH_PRESETS,
        favorites: defaultFavorites
      });
    }
  }, [brushLibrary.brushes.length, setBrushLibraryState]);

  /**
   * Get current brush preset - prioritizes selected preset over legacy settings
   */
  const createCurrentBrushPreset = useCallback((): BrushPreset => {
    
    // Priority 1: Use selected modular preset if available
    if (selectedBrushPreset && brushLibrary.brushes.length > 0) {
      const selectedPreset = brushLibrary.brushes.find(b => b.id === selectedBrushPreset);
      if (selectedPreset) {
        return selectedPreset;
      }
    }
    
    // Priority 2: Convert legacy brush settings to modular preset
    const components = [];

    // Pressure handling component (Priority 10 - first in pipeline)
    components.push({
      id: 'pressure-handler',
      type: ComponentType.PRESSURE_HANDLER,
      priority: 10,
      enabled: true,
      parameters: {
        inputSource: 'mouse', // Default to mouse, can be enhanced later
        pressureCurve: [0, 0.25, 0.5, 0.75, 1], // Linear curve
        velocityInfluence: 0.2,
        smoothing: 0.1,
        minimumPressure: 0.1
      }
    });

    // Size component (Priority 20 - after pressure handler)
    components.push({
      id: 'size-modifier',
      type: ComponentType.SIZE_MODIFIER,
      priority: 20,
      enabled: true,
      parameters: {
        baseSize: brushSettings.size,
        pressureInfluence: brushSettings.pressureSettings.enabled ? 0.5 : 0,
        minSize: brushSettings.pressureSettings.enabled ? brushSettings.pressureSettings.minValue : brushSettings.size,
        maxSize: brushSettings.pressureSettings.enabled ? brushSettings.pressureSettings.maxValue : brushSettings.size,
        variationAmount: 0,
        variationSeed: Math.random() * 1000
      }
    });

    // Opacity component (Priority 30 - after size)
    components.push({
      id: 'opacity-modifier',
      type: ComponentType.OPACITY_MODIFIER,
      priority: 30,
      enabled: true,
      parameters: {
        baseOpacity: brushSettings.opacity,
        pressureInfluence: brushSettings.pressureSettings.enabled ? 0.3 : 0,
        velocityInfluence: 0.1,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        minOpacity: 0.1,
        maxOpacity: 1.0,
        opacityJitter: 0,
        buildup: false,
        buildupRate: 0.1
      }
    });

    // Spacing component (Priority 25 - controls stroke spacing)
    components.push({
      id: 'spacing',
      type: ComponentType.SPACING,
      priority: 25,
      enabled: true,
      parameters: {
        defaultSpacing: brushSettings.spacing.defaultValue,
        fixedSpacing: brushSettings.spacing.value,
        dynamicEnabled: brushSettings.spacing.dynamicEnabled,
        velocityInfluence: 0.3,
        minSpacing: 1,
        maxSpacing: Math.max(50, brushSettings.spacing.value * 2)
      } as SpacingParams
    });

    // Anti-aliasing component (Priority 50 - mid-pipeline)
    components.push({
      id: 'anti-aliasing',
      type: ComponentType.ANTI_ALIASING,
      priority: 50,
      enabled: true,
      parameters: {
        mode: brushSettings.pixelPerfect ? 'pixel' : 'antialiased',
        pixelAlignment: brushSettings.pixelPerfect,
        edgeSharpness: brushSettings.pixelPerfect ? 1.0 : 0.5,
        subpixelPrecision: !brushSettings.pixelPerfect
      }
    });

    return {
      id: 'current-brush',
      name: 'Current Brush',
      category: 'Current',
      components,
      thumbnail: '',
      tags: [],
      isFavorite: false,
      isDefault: false,
      createdAt: new Date(),
      modifiedAt: new Date()
    };
  }, [selectedBrushPreset, brushLibrary.brushes, brushSettings]);

  /**
   * Convert modular preset to legacy brush settings
   */
  const convertPresetToSettings = useCallback((preset: BrushPreset) => {
    const sizeComponent = preset.components.find(c => c.type === ComponentType.SIZE_MODIFIER);
    const pressureComponent = preset.components.find(c => c.type === ComponentType.PRESSURE_HANDLER);
    const antialiasingComponent = preset.components.find(c => c.type === ComponentType.ANTI_ALIASING);
    
    const baseSize = sizeComponent?.parameters?.baseSize || brushSettings.size;
    
    const newSettings = {
      size: baseSize,
      opacity: brushSettings.opacity, // Keep current opacity unless we add opacity component
      pixelPerfect: antialiasingComponent?.parameters?.mode === 'pixel',
      pressureSettings: {
        enabled: pressureComponent?.enabled || false,
        minValue: pressureComponent?.parameters?.minimumPressure || 0.1,
        maxValue: sizeComponent?.parameters?.maxSize || brushSettings.size
      }
    };
    
    return newSettings;
  }, [brushSettings]);

  /**
   * Sync legacy settings when modular preset is selected
   * Guard against circular updates by checking if settings actually need to change
   */
  useEffect(() => {
    if (selectedBrushPreset && brushLibrary.brushes.length > 0) {
      // Only sync if this is a different preset than last time
      if (lastSyncedPreset.current !== selectedBrushPreset) {
        const selectedPreset = brushLibrary.brushes.find(b => b.id === selectedBrushPreset);
        if (selectedPreset) {
          const newSettings = convertPresetToSettings(selectedPreset);
          setBrushSettings(newSettings);
          lastSyncedPreset.current = selectedBrushPreset;
        }
      }
    }
  }, [selectedBrushPreset, brushLibrary.brushes, convertPresetToSettings, setBrushSettings]);

  /**
   * Execute brush stroke using modular engine
   */
  const executeBrushStroke = useCallback((
    x: number,
    y: number,
    p5Instance: any,
    isDragging: boolean = false,
    pressure?: number,
    context?: CanvasRenderingContext2D
  ): boolean => {
    try {
      // Create stroke input
      const strokeInput = isDragging 
        ? strokeInputFactory.current.continueStroke(x, y, pressure)
        : strokeInputFactory.current.startStroke(x, y);

      // Get current brush preset
      const currentPreset = createCurrentBrushPreset();

      // Execute modular brush with current color
      const success = canvasIntegration.current.executeModularBrush(
        currentPreset,
        strokeInput,
        p5Instance,
        context,
        brushSettings.color // Pass current brush color to modular system
      );

      return success;
    } catch (error) {
      console.error('Brush stroke execution failed:', error);
      return false; // Fallback to existing system
    }
  }, [createCurrentBrushPreset, brushSettings.color]);

  /**
   * Start a new stroke
   */
  const startStroke = useCallback((x: number, y: number, pressure?: number): void => {
    // Reset brush engine components for new stroke
    canvasIntegration.current.resetBrushEngine();
    strokeInputFactory.current.startStroke(x, y, performance.now());
  }, []);

  /**
   * End the current stroke
   */
  const endStroke = useCallback((x: number, y: number): void => {
    strokeInputFactory.current.endStroke(x, y, performance.now());
  }, []);

  /**
   * Check if modular brush should be used
   */
  const shouldUseModularBrush = useCallback((): boolean => {
    const currentPreset = createCurrentBrushPreset();
    return canvasIntegration.current.shouldUseModularBrush(currentPreset);
  }, [createCurrentBrushPreset]);

  /**
   * Get performance metrics
   */
  const getPerformanceMetrics = useCallback(() => {
    return canvasIntegration.current.getPerformanceMetrics();
  }, []);

  /**
   * Reset performance tracking
   */
  const resetPerformanceTracking = useCallback(() => {
    canvasIntegration.current.resetPerformanceTracking();
  }, []);

  /**
   * Reset stroke state
   */
  const resetStrokeState = useCallback(() => {
    strokeInputFactory.current.reset();
  }, []);

  /**
   * Check if stroke is in progress
   */
  const isStrokeInProgress = useCallback((): boolean => {
    return strokeInputFactory.current.isStrokeInProgress();
  }, []);

  /**
   * Get current brush preset (memoized for performance)
   */
  const currentBrushPreset = useMemo(() => {
    return createCurrentBrushPreset();
  }, [createCurrentBrushPreset]);

  return {
    // Core brush execution
    executeBrushStroke,
    shouldUseModularBrush,
    currentBrushPreset,
    
    // Stroke management
    startStroke,
    endStroke,
    isStrokeInProgress,
    resetStrokeState,
    
    // Performance monitoring
    getPerformanceMetrics,
    resetPerformanceTracking,
    
    // Settings conversion
    createCurrentBrushPreset
  };
};