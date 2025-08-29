/**
 * Feature Flags for TinyBrush
 * Allows toggling between different implementations during migration
 */

export interface FeatureFlags {
  // Color Cycle Implementation
  useCanvas2DColorCycle: boolean;
  
  // Performance optimizations
  enableBatchRendering: boolean;
  enableCanvasPooling: boolean;
  
  // Debug features
  showPerformanceStats: boolean;
  logColorCycleOperations: boolean;
}

// Default feature flags
const defaultFlags: FeatureFlags = {
  useCanvas2DColorCycle: true, // Default to Canvas2D implementation
  enableBatchRendering: true,
  enableCanvasPooling: true,
  showPerformanceStats: false,
  logColorCycleOperations: true, // Enable logging to verify implementation
};

// Load flags from localStorage if available
const loadStoredFlags = (): Partial<FeatureFlags> => {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem('tinybrush-feature-flags');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load feature flags from localStorage:', error);
  }
  
  return {};
};

// Merge stored flags with defaults
const storedFlags = loadStoredFlags();
export const featureFlags: FeatureFlags = {
  ...defaultFlags,
  ...storedFlags,
};

// Helper to update feature flags at runtime
export const setFeatureFlag = <K extends keyof FeatureFlags>(
  flag: K,
  value: FeatureFlags[K]
): void => {
  featureFlags[flag] = value;
  
  // Persist to localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('tinybrush-feature-flags', JSON.stringify(featureFlags));
    } catch (error) {
      console.warn('Failed to save feature flags to localStorage:', error);
    }
  }
  
  // Dispatch custom event for components to react to flag changes
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('feature-flag-changed', {
      detail: { flag, value }
    }));
  }
};

// Helper to reset all flags to defaults
export const resetFeatureFlags = (): void => {
  Object.keys(defaultFlags).forEach(key => {
    const flag = key as keyof FeatureFlags;
    featureFlags[flag] = defaultFlags[flag];
  });
  
  // Clear from localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('tinybrush-feature-flags');
    } catch (error) {
      console.warn('Failed to clear feature flags from localStorage:', error);
    }
  }
};

// Export a hook for React components
export const useFeatureFlag = <K extends keyof FeatureFlags>(
  flag: K
): FeatureFlags[K] => {
  if (typeof window === 'undefined') {
    return defaultFlags[flag];
  }
  
  // In a real React app, you'd use useState and useEffect here
  // For now, just return the current value
  return featureFlags[flag];
};