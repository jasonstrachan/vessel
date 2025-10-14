# Zustand Subscription Optimization Analysis

## Current Task
Analyze Vessel codebase for components using broad Zustand subscriptions that could benefit from selective subscriptions to reduce unnecessary re-renders.

## Findings

### 1. BrushControls.tsx - ✅ ALREADY OPTIMIZED
**Current subscription:**
```typescript
const { tools, setBrushSettings, setEraserSettings } = useAppStore();
```
**Analysis:** This component only subscribes to specific selectors it needs. Already well-optimized.

### 2. MiniCanvas.tsx - ❌ NEEDS OPTIMIZATION
**Current subscription:**
```typescript
const { tools, project, temporaryCustomBrush, brushPresets, setBrushSettings } = useAppStore();
```
**Issues:** 
- Subscribes to entire `tools` object but only uses `brushSettings`
- Pulls large objects like `project` and `brushPresets` which can cause unnecessary re-renders
- Complex component with many dependencies

**Optimized approach:**
```typescript
const brushSettings = useAppStore(state => state.tools.brushSettings);
const selectedCustomBrush = useAppStore(state => state.tools.brushSettings.selectedCustomBrush);
const temporaryCustomBrush = useAppStore(state => state.temporaryCustomBrush);
const customBrushes = useAppStore(state => state.project?.customBrushes);
const brushPresets = useAppStore(state => state.brushPresets.filter(p => p.isCustomBrush));
const setBrushSettings = useAppStore(state => state.setBrushSettings);
```

### 3. LayerPanel.tsx - ❌ NEEDS MAJOR OPTIMIZATION
**Current subscription:**
```typescript
const { 
  layers, 
  activeLayerId, 
  project,
  addLayer, 
  removeLayer, 
  updateLayer, 
  setActiveLayer,
  reorderLayers
} = useAppStore();
```
**Issues:**
- Subscribes to entire `project` but only uses `project.width` and `project.height` for new layer creation
- All layer operations cause full re-render

**Optimized approach:**
```typescript
const layers = useAppStore(state => state.layers);
const activeLayerId = useAppStore(state => state.activeLayerId);
const projectDimensions = useAppStore(state => 
  state.project ? { width: state.project.width, height: state.project.height } : null
);
const addLayer = useAppStore(state => state.addLayer);
const removeLayer = useAppStore(state => state.removeLayer);
const updateLayer = useAppStore(state => state.updateLayer);
const setActiveLayer = useAppStore(state => state.setActiveLayer);
const reorderLayers = useAppStore(state => state.reorderLayers);
```

### 4. ColorPickerPanel.tsx - ✅ MOSTLY OPTIMIZED
**Current subscription:**
```typescript
const { tools, setBrushSettings, setEraserSettings } = useAppStore();
```
**Analysis:** Good selective subscription pattern. Could be improved slightly:

**Optimized approach:**
```typescript
const currentTool = useAppStore(state => state.tools.currentTool);
const brushSettings = useAppStore(state => state.tools.brushSettings);
const eraserSettings = useAppStore(state => state.tools.eraserSettings);
const setBrushSettings = useAppStore(state => state.setBrushSettings);
const setEraserSettings = useAppStore(state => state.setEraserSettings);
```

### 5. BrushLibrary.tsx - ❌ NEEDS OPTIMIZATION
**Current subscription (uses individual selectors - partially optimized):**
```typescript
const brushPresets = useAppStore((state) => state.brushPresets);
const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
const setBrushPreset = useAppStore((state) => state.setBrushPreset);
const setBrushSettings = useAppStore((state) => state.setBrushSettings);
const saveCustomBrushAsPreset = useAppStore((state) => state.saveCustomBrushAsPreset);
const removeBrushPreset = useAppStore((state) => state.removeBrushPreset);
const removeCustomBrush = useAppStore((state) => state.removeCustomBrush);
const tools = useAppStore((state) => state.tools);
const project = useAppStore((state) => state.project);
const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
```
**Issues:**
- Still subscribes to entire `tools` and `project` objects
- Multiple subscriptions could be consolidated with shallow comparison

**Optimized approach:**
```typescript
const brushLibraryData = useAppStore(state => ({
  brushPresets: state.brushPresets,
  currentBrushPreset: state.currentBrushPreset,
  selectedCustomBrush: state.tools.brushSettings.selectedCustomBrush,
  customBrushes: state.project?.customBrushes,
  temporaryCustomBrush: state.temporaryCustomBrush
}), shallow);
const actions = useAppStore(state => ({
  setBrushPreset: state.setBrushPreset,
  setBrushSettings: state.setBrushSettings,
  saveCustomBrushAsPreset: state.saveCustomBrushAsPreset,
  removeBrushPreset: state.removeBrushPreset,
  removeCustomBrush: state.removeCustomBrush
}));
```

### 6. MiniCanvasPanel.tsx - ✅ WELL OPTIMIZED
**Current subscription:**
```typescript
const { tools, setBrushSettings } = useAppStore();
```
**Analysis:** Simple and focused, good pattern.

### 7. CustomBrushPanel.tsx - ❌ NEEDS OPTIMIZATION
**Current subscription:**
```typescript
const { 
  project, 
  addCustomBrush, 
  currentLayer,
  selectionStart,
  selectionEnd,
  clearSelection,
  setBrushSettings,
  tools
} = useAppStore();
```
**Issues:**
- Subscribes to entire `project` and `tools` objects

**Optimized approach:**
```typescript
const selectionData = useAppStore(state => ({
  selectionStart: state.selectionStart,
  selectionEnd: state.selectionEnd,
  currentLayer: state.currentLayer,
  projectLayers: state.project?.layers
}), shallow);
const actions = useAppStore(state => ({
  addCustomBrush: state.addCustomBrush,
  clearSelection: state.clearSelection,
  setBrushSettings: state.setBrushSettings
}));
```

## Performance Impact Assessment

### High Impact (Priority 1)
1. **MiniCanvas.tsx** - Complex component with frequent updates
2. **LayerPanel.tsx** - Renders list of layers, frequent layer operations

### Medium Impact (Priority 2)
3. **BrushLibrary.tsx** - Large list rendering
4. **CustomBrushPanel.tsx** - Selection-dependent operations

### Low Impact (Priority 3)
5. **ColorPickerPanel.tsx** - Already mostly optimized

## Implementation Plan

### TODO
- [ ] Optimize MiniCanvas.tsx subscriptions
- [ ] Optimize LayerPanel.tsx subscriptions
- [ ] Optimize BrushLibrary.tsx subscriptions
- [ ] Optimize CustomBrushPanel.tsx subscriptions
- [ ] Fine-tune ColorPickerPanel.tsx subscriptions
- [ ] Add shallow comparison imports where needed
- [ ] Test performance improvements
- [ ] Document changes

### Completed
- [x] Analysis complete
- [x] Prioritization done
