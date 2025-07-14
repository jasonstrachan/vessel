// Debug utilities for TinyBrush save/load functionality

import { useAppStore } from '../stores/useAppStore';

export function debugProjectState() {
  const store = useAppStore.getState();
  
  console.log('=== TinyBrush Debug Report ===');
  console.log('Project:', store.project);
  console.log('Layers in store:', store.layers);
  console.log('Active layer ID:', store.activeLayerId);
  console.log('Layers need recomposition:', store.layersNeedRecomposition);
  
  if (store.project) {
    console.log('Project layers:', store.project.layers);
    console.log('Project custom brushes:', store.project.customBrushes);
  }
  
  if (store.layers.length > 0) {
    store.layers.forEach((layer, index) => {
      console.log(`Layer ${index}:`, {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        hasImageData: !!layer.imageData,
        imageDataSize: layer.imageData ? `${layer.imageData.width}x${layer.imageData.height}` : 'none'
      });
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
  
  console.log('=== Canvas Debug ===');
  console.log('Display canvas:', canvases.display);
  console.log('Offscreen canvas:', canvases.offscreen);
  
  if (canvases.display) {
    const ctx = canvases.display.getContext('2d');
    console.log('Display canvas size:', `${canvases.display.width}x${canvases.display.height}`);
    console.log('Display canvas context:', ctx);
  }
  
  if (canvases.offscreen) {
    const ctx = canvases.offscreen.getContext('2d');
    console.log('Offscreen canvas size:', `${canvases.offscreen.width}x${canvases.offscreen.height}`);
    console.log('Offscreen canvas context:', ctx);
  }
  
  return canvases;
}

export async function testSaveOperation() {
  console.log('=== Testing Save Operation ===');
  
  const state = debugProjectState();
  if (!state.hasProject) {
    console.error('No project to save!');
    return false;
  }
  
  if (state.layersWithData === 0) {
    console.warn('No layers have image data to save!');
  }
  
  try {
    const store = useAppStore.getState();
    const projectData = await import('../utils/projectIO').then(m => m.serializeProject(store.project!));
    console.log('Serialized project data length:', projectData.length);
    console.log('First 200 chars:', projectData.substring(0, 200));
    return true;
  } catch (error) {
    console.error('Save operation failed:', error);
    return false;
  }
}

export async function simulateDrawing() {
  console.log('=== Simulating Drawing Data ===');
  
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
  
  console.log('Added test drawing data to layer');
  return debugProjectState();
}

export async function runFullDebugCheck() {
  console.log('=== FULL DEBUG CHECK ===');
  
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
  console.log('=== Testing Canvas Capture ===');
  
  const store = useAppStore.getState();
  if (!store.captureCanvasToActiveLayer) {
    console.error('captureCanvasToActiveLayer function not available');
    return false;
  }
  
  try {
    store.captureCanvasToActiveLayer();
    console.log('Canvas capture completed');
    
    // Check if any layer now has image data
    const layersWithData = store.layers.filter(l => l.imageData);
    console.log(`Layers with image data after capture: ${layersWithData.length}`);
    
    return layersWithData.length > 0;
  } catch (error) {
    console.error('Canvas capture failed:', error);
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
      console.log('=== Testing Load Operation ===');
      try {
        const { loadProjectFromFile } = await import('./projectIO');
        console.log('Load function available:', typeof loadProjectFromFile);
        return true;
      } catch (error) {
        console.error('Load test failed:', error);
        return false;
      }
    }
  };
}