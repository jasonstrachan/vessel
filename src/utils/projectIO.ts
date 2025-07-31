// Project input/output utilities for TinyBrush
// Handles serialization, deserialization, and file operations

import type { Project, Layer, CustomBrush } from '../types';

// TinyBrush project file format version
const PROJECT_VERSION = '1.0.0';

export interface TinyBrushProject {
  version: string;
  metadata: {
    name: string;
    created: string;
    modified: string;
    appVersion: string;
  };
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    layers: SerializedLayer[];
    customBrushes: SerializedCustomBrush[];
    thumbnail?: string;
  };
}

interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  order: number;
  imageDataUrl: string; // Base64 encoded ImageData
}

interface SerializedCustomBrush {
  id: string;
  name: string;
  width: number;
  height: number;
  imageDataUrl: string; // Base64 encoded ImageData
  thumbnail: string;
  createdAt: number;
}

// Convert ImageData to base64 encoded raw pixel data (lossless)
function imageDataToDataUrl(imageData: ImageData): string {
  // Serialize ImageData as raw RGBA pixel data to preserve exact values
  const rawData = {
    width: imageData.width,
    height: imageData.height,
    data: Array.from(imageData.data) // Convert Uint8ClampedArray to regular array for JSON
  };
  
  // Encode as base64 JSON to avoid PNG compression artifacts
  const jsonString = JSON.stringify(rawData);
  const base64 = btoa(jsonString);
  return `data:application/json;base64,${base64}`;
}

// Convert base64 raw pixel data back to ImageData (lossless)
function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    try {
      // Check if this is raw pixel data format
      if (dataUrl.startsWith('data:application/json;base64,')) {
        const base64 = dataUrl.substring('data:application/json;base64,'.length);
        const jsonString = atob(base64);
        const rawData = JSON.parse(jsonString);
        
        // Recreate ImageData from raw pixel data
        const imageData = new ImageData(
          new Uint8ClampedArray(rawData.data),
          rawData.width,
          rawData.height
        );
        resolve(imageData);
        return;
      }
      
      // Fallback: handle old PNG format for backward compatibility
      if (dataUrl.startsWith('data:image/png;base64,')) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(imageData);
        };
        img.onerror = () => reject(new Error('Failed to load image data'));
        img.src = dataUrl;
        return;
      }
      
      reject(new Error('Unsupported data format'));
    } catch (error) {
      reject(error);
    }
  });
}

// Serialize a layer for saving
function serializeLayer(layer: Layer): SerializedLayer {
  
  let imageDataUrl = '';
  if (layer.imageData) {
    try {
      imageDataUrl = imageDataToDataUrl(layer.imageData);
    } catch (error) {
    }
  } else {
  }
  
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    order: layer.order,
    imageDataUrl
  };
}

// Deserialize a layer from saved data
async function deserializeLayer(serializedLayer: SerializedLayer, projectWidth: number, projectHeight: number): Promise<Layer> {
  
  let imageData: ImageData | null = null;
  if (serializedLayer.imageDataUrl) {
    try {
      imageData = await dataUrlToImageData(serializedLayer.imageDataUrl);
    } catch (error) {
    }
  } else {
  }
  
  // Create framebuffer with project dimensions
  const framebuffer = new OffscreenCanvas(projectWidth, projectHeight);
  
  return {
    id: serializedLayer.id,
    name: serializedLayer.name,
    visible: serializedLayer.visible,
    opacity: serializedLayer.opacity,
    blendMode: serializedLayer.blendMode as GlobalCompositeOperation,
    locked: serializedLayer.locked,
    order: serializedLayer.order,
    imageData,
    framebuffer
  };
}

// Serialize a custom brush for saving
function serializeCustomBrush(brush: CustomBrush): SerializedCustomBrush {
  return {
    id: brush.id,
    name: brush.name,
    width: brush.width,
    height: brush.height,
    imageDataUrl: imageDataToDataUrl(brush.imageData),
    thumbnail: brush.thumbnail,
    createdAt: brush.createdAt
  };
}

// Deserialize a custom brush from saved data
async function deserializeCustomBrush(serializedBrush: SerializedCustomBrush): Promise<CustomBrush> {
  
  const imageData = await dataUrlToImageData(serializedBrush.imageDataUrl);
  
  
  return {
    id: serializedBrush.id,
    name: serializedBrush.name,
    width: serializedBrush.width,
    height: serializedBrush.height,
    imageData,
    thumbnail: serializedBrush.thumbnail,
    createdAt: serializedBrush.createdAt
  };
}

// Generate thumbnail from project layers
function generateProjectThumbnail(project: Project, layers: Layer[], maxSize: number = 128): string {
  const canvas = document.createElement('canvas');
  const aspectRatio = project.width / project.height;
  
  if (aspectRatio > 1) {
    canvas.width = maxSize;
    canvas.height = Math.round(maxSize / aspectRatio);
  } else {
    canvas.width = Math.round(maxSize * aspectRatio);
    canvas.height = maxSize;
  }
  
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return '';
  
  const scaleX = canvas.width / project.width;
  const scaleY = canvas.height / project.height;
  
  ctx.scale(scaleX, scaleY);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  ctx.fillStyle = project.backgroundColor;
  ctx.fillRect(0, 0, project.width, project.height);
  
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible || !layer.imageData) continue;
    
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.imageData.width;
    layerCanvas.height = layer.imageData.height;
    const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (layerCtx) {
      layerCtx.putImageData(layer.imageData, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }
  
  return canvas.toDataURL('image/png', 0.8);
}

// Serialize a project for saving
export async function serializeProject(project: Project, layers?: Layer[]): Promise<string> {
  const serializedLayers = project.layers.map(serializeLayer);
  const serializedCustomBrushes = project.customBrushes.map(serializeCustomBrush);
  
  let thumbnail = '';
  if (layers) {
    thumbnail = generateProjectThumbnail(project, layers);
  }
  
  const tinyBrushProject: TinyBrushProject = {
    version: PROJECT_VERSION,
    metadata: {
      name: project.name,
      created: project.createdAt.toISOString(),
      modified: new Date().toISOString(),
      appVersion: '1.0.0' // Could be pulled from package.json
    },
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      backgroundColor: project.backgroundColor,
      layers: serializedLayers,
      customBrushes: serializedCustomBrushes,
      thumbnail: thumbnail || undefined
    }
  };
  
  return JSON.stringify(tinyBrushProject, null, 2);
}

// Deserialize a project from saved data
export async function deserializeProject(projectData: string): Promise<Project> {
  let tinyBrushProject: TinyBrushProject;
  
  try {
    tinyBrushProject = JSON.parse(projectData);
  } catch (error) {
    throw new Error('Invalid project file format');
  }
  
  // Validate project format
  if (!tinyBrushProject.version || !tinyBrushProject.project) {
    throw new Error('Invalid TinyBrush project file');
  }
  
  // TODO: Add version migration logic here if needed
  
  const serializedProject = tinyBrushProject.project;
  
  // Deserialize layers
  const layers = await Promise.all(
    serializedProject.layers.map(layer => deserializeLayer(layer, serializedProject.width, serializedProject.height))
  );
  
  // Deserialize custom brushes
  
  const customBrushes = await Promise.all(
    serializedProject.customBrushes.map(deserializeCustomBrush)
  );
  
  
  return {
    id: serializedProject.id,
    name: serializedProject.name,
    width: serializedProject.width,
    height: serializedProject.height,
    backgroundColor: serializedProject.backgroundColor,
    layers,
    customBrushes,
    createdAt: new Date(tinyBrushProject.metadata.created),
    updatedAt: new Date(tinyBrushProject.metadata.modified)
  };
}

// Save project to file using File System Access API with fallback
export async function saveProjectToFile(project: Project, filename?: string, layers?: Layer[]): Promise<void> {
  const projectData = await serializeProject(project, layers);
  const fileName = filename || `${project.name}.tb`;
  
  // Check if File System Access API is supported
  if ('showSaveFilePicker' in window) {
    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'TinyBrush Project Files',
          accept: { 'application/json': ['.tb'] }
        }]
      });
      
      const writable = await fileHandle.createWritable();
      await writable.write(projectData);
      await writable.close();
      return;
    } catch (error) {
      // User cancelled or API not supported, fall back to download
    }
  }
  
  // Fallback: create download link
  const blob = new Blob([projectData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Load project from file
export async function loadProjectFromFile(): Promise<Project> {
  // Check if File System Access API is supported
  if ('showOpenFilePicker' in window) {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'TinyBrush Project Files',
          accept: { 'application/json': ['.tb'] }
        }],
        multiple: false
      });
      
      const file = await fileHandle.getFile();
      const projectData = await file.text();
      return await deserializeProject(projectData);
    } catch (error) {
      // User cancelled or API not supported, fall back to file input
    }
  }
  
  // Fallback: create file input
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tb,application/json';
    
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      
      try {
        const projectData = await file.text();
        const project = await deserializeProject(projectData);
        resolve(project);
      } catch (error) {
        reject(error);
      }
    };
    
    input.click();
  });
}

// Export project as PNG
export async function exportProjectAsPNG(
  project: Project, 
  layers: Layer[], 
  options: {
    includeBackground?: boolean;
    scale?: number;
    quality?: number;
  } = {}
): Promise<void> {
  const { includeBackground = true, scale = 1, quality = 1 } = options;
  
  const canvas = document.createElement('canvas');
  canvas.width = project.width * scale;
  canvas.height = project.height * scale;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Scale context if needed
  if (scale !== 1) {
    ctx.scale(scale, scale);
  }
  
  // Draw background if requested
  if (includeBackground) {
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  
  // Draw layers in order
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible || !layer.imageData) continue;
    
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    
    // Create temporary canvas for the layer
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.imageData.width;
    layerCanvas.height = layer.imageData.height;
    const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (layerCtx) {
      layerCtx.putImageData(layer.imageData, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }
  
  // Save as PNG
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png', quality);
}

// Validate project file format
export function validateProjectFile(projectData: string): { valid: boolean; error?: string } {
  try {
    const project = JSON.parse(projectData);
    
    if (!project.version) {
      return { valid: false, error: 'Missing version information' };
    }
    
    if (!project.project) {
      return { valid: false, error: 'Missing project data' };
    }
    
    const { project: projectInfo } = project;
    
    if (!projectInfo.id || !projectInfo.name || !projectInfo.width || !projectInfo.height) {
      return { valid: false, error: 'Missing required project properties' };
    }
    
    if (!Array.isArray(projectInfo.layers)) {
      return { valid: false, error: 'Invalid layers data' };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid JSON format' };
  }
}