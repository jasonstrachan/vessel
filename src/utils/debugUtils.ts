// Debug utilities for brush settings persistence debugging
// Add to browser console to inspect state in real-time

export const createBrushDebugUtils = (store: any) => {
  const debugUtils = {
    // Get current brush settings state
    getCurrentState: () => {
      const state = store.getState();
      return {
        currentBrushPreset: state.currentBrushPreset?.id,
        currentBrushSettings: state.tools.brushSettings,
        brushSpecificSettings: state.brushSpecificSettings,
        globalBrushSize: state.globalBrushSize
      };
    },

    // Watch for brush settings changes
    watchBrushChanges: () => {
      let previousState = debugUtils.getCurrentState();
      
      const unsubscribe = store.subscribe(() => {
        const currentState = debugUtils.getCurrentState();
        
        // Check if brush preset changed
        if (currentState.currentBrushPreset !== previousState.currentBrushPreset) {
          console.log('🔄 [WATCH] Brush preset changed:', {
            from: previousState.currentBrushPreset,
            to: currentState.currentBrushPreset,
            newSettings: currentState.currentBrushSettings,
            savedSettings: currentState.brushSpecificSettings
          });
        }

        // Check if brush settings changed
        if (JSON.stringify(currentState.currentBrushSettings) !== JSON.stringify(previousState.currentBrushSettings)) {
          console.log('⚙️ [WATCH] Brush settings changed:', {
            previousSettings: previousState.currentBrushSettings,
            newSettings: currentState.currentBrushSettings,
            currentPreset: currentState.currentBrushPreset
          });
        }

        // Check if brush-specific settings changed
        if (JSON.stringify(currentState.brushSpecificSettings) !== JSON.stringify(previousState.brushSpecificSettings)) {
          console.log('💾 [WATCH] BrushSpecificSettings changed:', {
            previousSaved: previousState.brushSpecificSettings,
            newSaved: currentState.brushSpecificSettings
          });
        }

        previousState = currentState;
      });

      console.log('👀 [DEBUG] Started watching brush changes. Call stopWatching() to stop.');
      return unsubscribe;
    },

    // Manual test: save and switch brushes to test persistence
    testBrushPersistence: async () => {
      console.log('🧪 [TEST] Starting brush persistence test...');
      
      const state = store.getState();
      const originalPreset = state.currentBrushPreset?.id;
      const originalSettings = { ...state.tools.brushSettings };
      
      console.log('Step 1: Recording initial state:', {
        preset: originalPreset,
        settings: originalSettings
      });

      // Modify some settings
      console.log('Step 2: Modifying brush settings...');
      store.getState().setBrushSettings({
        opacity: 0.75,
        spacing: 8,
        colorJitter: 25
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Switch to a different brush
      console.log('Step 3: Switching to different brush...');
      const brushPresets = store.getState().brushPresets;
      const differentPreset = brushPresets.find((p: any) => p.id !== originalPreset);
      if (differentPreset) {
        store.getState().setBrushPreset(differentPreset);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Switch back to original brush
      console.log('Step 4: Switching back to original brush...');
      const originalPresetObj = brushPresets.find((p: any) => p.id === originalPreset);
      if (originalPresetObj) {
        store.getState().setBrushPreset(originalPresetObj);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if settings were restored
      const finalState = store.getState();
      const finalSettings = finalState.tools.brushSettings;
      
      console.log('Step 5: Checking if settings were restored:', {
        expectedOpacity: 0.75,
        actualOpacity: finalSettings.opacity,
        expectedSpacing: 8,
        actualSpacing: finalSettings.spacing,
        expectedColorJitter: 25,
        actualColorJitter: finalSettings.colorJitter,
        settingsMatch: finalSettings.opacity === 0.75 && 
                     finalSettings.spacing === 8 && 
                     finalSettings.colorJitter === 25
      });

      const testPassed = finalSettings.opacity === 0.75 && 
                        finalSettings.spacing === 8 && 
                        finalSettings.colorJitter === 25;

      console.log(testPassed ? '✅ [TEST] Brush persistence test PASSED' : '❌ [TEST] Brush persistence test FAILED');
      
      return {
        passed: testPassed,
        original: originalSettings,
        final: finalSettings,
        savedSettings: finalState.brushSpecificSettings
      };
    },

    // Inspect specific brush settings
    inspectBrush: (brushId: string) => {
      const state = store.getState();
      const savedSettings = state.brushSpecificSettings[brushId];
      
      console.log(`🔍 [INSPECT] Brush ${brushId}:`, {
        savedSettings: savedSettings || 'No saved settings',
        isCurrentBrush: state.currentBrushPreset?.id === brushId,
        currentBrushSettings: state.currentBrushPreset?.id === brushId ? state.tools.brushSettings : 'Not current brush'
      });

      return savedSettings;
    },

    // Clear all debug logs
    clearLogs: () => {
      console.clear();
      console.log('🧹 [DEBUG] Console cleared');
    }
  };

  return debugUtils;
};

// Global debug setup for browser console
declare global {
  interface Window {
    brushDebug: ReturnType<typeof createBrushDebugUtils>;
    stopWatching?: () => void;
  }
}

export const setupGlobalBrushDebug = (store: any) => {
  if (typeof window !== 'undefined') {
    window.brushDebug = createBrushDebugUtils(store);
    console.log('🐛 [DEBUG] Global brush debug utils available as window.brushDebug');
    console.log('Available methods:');
    console.log('  - brushDebug.getCurrentState()');
    console.log('  - brushDebug.watchBrushChanges()');
    console.log('  - brushDebug.testBrushPersistence()');
    console.log('  - brushDebug.inspectBrush(brushId)');
    console.log('  - brushDebug.clearLogs()');
  }
};