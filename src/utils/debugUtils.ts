// Debug utilities for TinyBrush save/load functionality

import { useAppStore } from '../stores/useAppStore';

export function debugProjectState() {
  const store = useAppStore.getState();
  
  
  if (store.project) {
  }
  
  if (store.layers.length > 0) {
    store.layers.forEach((layer, index) => {
    });
  }
  
  return {
    hasProject: !!store.project,
    hasLayers: store.layers.length > 0,
    hasActiveLayer: !!store.activeLayerId,
    layersWithData: store.layers.filter(l => l.imageData).length
  };
}

export function debugCanvasState() {
  const canvases = {
    display: document.querySelector('canvas'),
    offscreen: null as HTMLCanvasElement | null
  };
  
  // Try to find offscreen canvas through refs or data attributes
  const canvasElements = document.querySelectorAll('canvas');
  canvasElements.forEach(canvas => {
    if (canvas.style.display === 'none' || canvas.hidden) {
      canvases.offscreen = canvas;
    }
  });
  
  
  if (canvases.display) {
    const ctx = canvases.display.getContext('2d');
  }
  
  if (canvases.offscreen) {
    const ctx = canvases.offscreen.getContext('2d');
  }
  
  return canvases;
}

export async function testSaveOperation() {
  
  const state = debugProjectState();
  if (!state.hasProject) {
    return false;
  }
  
  if (state.layersWithData === 0) {
  }
  
  try {
    const store = useAppStore.getState();
    const projectData = await import('../utils/projectIO').then(m => m.serializeProject(store.project!));
    return true;
  } catch (error) {
    return false;
  }
}

export async function simulateDrawing() {
  
  const store = useAppStore.getState();
  
  // Create a test layer with some image data
  const testImageData = new ImageData(100, 100);
  // Fill with some test pattern
  for (let i = 0; i < testImageData.data.length; i += 4) {
    testImageData.data[i] = 255;     // Red
    testImageData.data[i + 1] = 0;   // Green  
    testImageData.data[i + 2] = 0;   // Blue
    testImageData.data[i + 3] = 255; // Alpha
  }
  
  if (store.layers.length === 0) {
    store.addLayer({
      name: 'Test Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: testImageData,
      framebuffer: new OffscreenCanvas(100, 100)
    });
  } else {
    store.updateLayer(store.layers[0].id, { imageData: testImageData });
  }
  
  return debugProjectState();
}

export async function runFullDebugCheck() {
  
  const projectState = debugProjectState();
  const canvasState = debugCanvasState();
  
  const summary = [];
  let overallHealth: 'good' | 'warning' | 'error' = 'good';
  
  // Check project state
  if (!projectState.hasProject) {
    summary.push('❌ No project loaded');
    overallHealth = 'error';
  } else {
    summary.push('✅ Project loaded');
  }
  
  if (projectState.hasLayers) {
    summary.push(`✅ ${projectState.layersWithData}/${projectState.hasLayers ? 'multiple' : 0} layers have data`);
  } else {
    summary.push('⚠️ No layers found');
    if (overallHealth === 'good') overallHealth = 'warning';
  }
  
  // Check canvas state
  if (canvasState.display) {
    summary.push('✅ Display canvas found');
  } else {
    summary.push('❌ Display canvas missing');
    overallHealth = 'error';
  }
  
  // Test save operation
  try {
    const saveTest = await testSaveOperation();
    if (saveTest) {
      summary.push('✅ Save operation test passed');
    } else {
      summary.push('❌ Save operation test failed');
      overallHealth = 'error';
    }
  } catch (error) {
    summary.push('❌ Save operation test error');
    overallHealth = 'error';
  }
  
  return {
    overallHealth,
    summary,
    projectState,
    canvasState
  };
}

export function testCanvasCapture() {
  
  const store = useAppStore.getState();
  if (!store.captureCanvasToActiveLayer) {
    return false;
  }
  
  try {
    store.captureCanvasToActiveLayer();
    
    // Check if any layer now has image data
    const layersWithData = store.layers.filter(l => l.imageData);
    
    return layersWithData.length > 0;
  } catch (error) {
    return false;
  }
}

// Make debug functions available in browser console
if (typeof window !== 'undefined') {
  (window as any).tinybrushDebug = {
    debugProjectState,
    debugCanvasState,
    testSaveOperation,
    simulateDrawing,
    runFullDebugCheck,
    testCanvasCapture,
    debugSaveOperation: testSaveOperation,
    debugLoadOperation: async () => {
      try {
        const { loadProjectFromFile } = await import('./projectIO');
        return true;
      } catch (error) {
        return false;
      }
    }
  };
}