/**
 * Accessibility provider for color cycle components
 * Ensures ARIA compliance, keyboard navigation, and screen reader support
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface AccessibilityState {
  announcements: string[];
  focusedElement: string | null;
  keyboardNavigation: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

interface AccessibilityActions {
  announce: (message: string) => void;
  setFocus: (elementId: string) => void;
  clearAnnouncements: () => void;
}

interface AccessibilityContextValue {
  state: AccessibilityState;
  actions: AccessibilityActions;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

interface Props {
  children: ReactNode;
}

export const AccessibilityProvider: React.FC<Props> = ({ children }) => {
  const [state, setState] = useState<AccessibilityState>({
    announcements: [],
    focusedElement: null,
    keyboardNavigation: false,
    reducedMotion: false,
    highContrast: false
  });

  // Detect user preferences
  useEffect(() => {
    const detectPreferences = () => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const highContrast = window.matchMedia('(prefers-contrast: high)').matches;
      
      setState(prev => ({
        ...prev,
        reducedMotion,
        highContrast
      }));
    };

    detectPreferences();
    
    // Listen for preference changes
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const highContrastQuery = window.matchMedia('(prefers-contrast: high)');
    
    const handleReducedMotionChange = (e: MediaQueryListEvent) => {
      setState(prev => ({ ...prev, reducedMotion: e.matches }));
    };
    
    const handleHighContrastChange = (e: MediaQueryListEvent) => {
      setState(prev => ({ ...prev, highContrast: e.matches }));
    };
    
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    highContrastQuery.addEventListener('change', handleHighContrastChange);
    
    return () => {
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      highContrastQuery.removeEventListener('change', handleHighContrastChange);
    };
  }, []);

  // Detect keyboard navigation
  useEffect(() => {
    const handleKeyDown = () => {
      setState(prev => ({ ...prev, keyboardNavigation: true }));
    };
    
    const handleMouseDown = () => {
      setState(prev => ({ ...prev, keyboardNavigation: false }));
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const actions: AccessibilityActions = {
    announce: (message: string) => {
      setState(prev => ({
        ...prev,
        announcements: [...prev.announcements, message]
      }));
      
      // Auto-clear after 5 seconds
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          announcements: prev.announcements.filter(a => a !== message)
        }));
      }, 5000);
    },
    
    setFocus: (elementId: string) => {
      setState(prev => ({ ...prev, focusedElement: elementId }));
      
      // Attempt to focus the element
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element && element.focus) {
          element.focus();
        }
      }, 10);
    },
    
    clearAnnouncements: () => {
      setState(prev => ({ ...prev, announcements: [] }));
    }
  };

  const contextValue: AccessibilityContextValue = {
    state,
    actions
  };

  return (
    <AccessibilityContext.Provider value={contextValue}>
      {children}
      <LiveRegion announcements={state.announcements} />
      <SkipLink />
    </AccessibilityContext.Provider>
  );
};

/**
 * Live region for screen reader announcements
 */
const LiveRegion: React.FC<{ announcements: string[] }> = ({ announcements }) => {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="sr-only"
    >
      {announcements.map((announcement, index) => (
        <div key={`announcement-${index}`}>
          {announcement}
        </div>
      ))}
    </div>
  );
};

/**
 * Skip link for keyboard navigation
 */
const SkipLink: React.FC = () => {
  const handleSkipToContent = (e: React.MouseEvent) => {
    e.preventDefault();
    const mainContent = document.querySelector('[role="main"]') || 
                       document.querySelector('main') ||
                       document.getElementById('main-content');
    
    if (mainContent && (mainContent as HTMLElement).focus) {
      (mainContent as HTMLElement).focus();
    }
  };

  return (
    <a
      href="#main-content"
      onClick={handleSkipToContent}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 bg-blue-600 text-white px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      Skip to main content
    </a>
  );
};

/**
 * Hook to use accessibility context
 */
export const useAccessibility = (): AccessibilityContextValue => {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider');
  }
  return context;
};

/**
 * Hook for keyboard shortcuts with accessibility
 */
export const useAccessibleKeyboard = (
  shortcuts: Record<string, () => void>,
  options: {
    enabled?: boolean;
    description?: string;
  } = {}
) => {
  const { actions } = useAccessibility();
  
  useEffect(() => {
    if (!options.enabled) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const modifiers = {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey
      };
      
      // Create key combination string
      const keyCombo = [
        modifiers.ctrl && 'ctrl',
        modifiers.alt && 'alt',
        modifiers.shift && 'shift',
        modifiers.meta && 'meta',
        key
      ].filter(Boolean).join('+');
      
      const handler = shortcuts[keyCombo] || shortcuts[key];
      
      if (handler) {
        e.preventDefault();
        handler();
        
        // Announce the action for screen readers
        if (options.description) {
          actions.announce(`${options.description} activated`);
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts, options.enabled, options.description, actions]);
};

/**
 * Color contrast utilities for accessibility
 */
export const ColorAccessibility = {
  /**
   * Calculate relative luminance for WCAG compliance
   */
  getLuminance: (r: number, g: number, b: number): number => {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  },

  /**
   * Calculate contrast ratio between two colors
   */
  getContrastRatio: (color1: [number, number, number], color2: [number, number, number]): number => {
    const lum1 = ColorAccessibility.getLuminance(...color1);
    const lum2 = ColorAccessibility.getLuminance(...color2);
    const brighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (brighter + 0.05) / (darker + 0.05);
  },

  /**
   * Check if color combination meets WCAG AA standard
   */
  meetsWCAGAA: (color1: [number, number, number], color2: [number, number, number]): boolean => {
    return ColorAccessibility.getContrastRatio(color1, color2) >= 4.5;
  },

  /**
   * Check if color combination meets WCAG AAA standard
   */
  meetsWCAGAAA: (color1: [number, number, number], color2: [number, number, number]): boolean => {
    return ColorAccessibility.getContrastRatio(color1, color2) >= 7.0;
  },

  /**
   * Generate accessible color variations
   */
  generateAccessibleVariant: (
    baseColor: [number, number, number],
    backgroundColor: [number, number, number] = [255, 255, 255]
  ): [number, number, number] => {
    let [r, g, b] = baseColor;
    
    // Try darkening first
    while (r > 0 || g > 0 || b > 0) {
      if (ColorAccessibility.meetsWCAGAA([r, g, b], backgroundColor)) {
        return [r, g, b];
      }
      r = Math.max(0, r - 15);
      g = Math.max(0, g - 15);
      b = Math.max(0, b - 15);
    }
    
    // If darkening doesn't work, try lightening
    [r, g, b] = baseColor;
    while (r < 255 || g < 255 || b < 255) {
      if (ColorAccessibility.meetsWCAGAA([r, g, b], backgroundColor)) {
        return [r, g, b];
      }
      r = Math.min(255, r + 15);
      g = Math.min(255, g + 15);
      b = Math.min(255, b + 15);
    }
    
    // Fallback to high contrast
    const luminance = ColorAccessibility.getLuminance(...backgroundColor);
    return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
  }
};