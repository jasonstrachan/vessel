# Testing the Modular Brush Plugin System

## Quick Test Guide

### 1. Open the Application
Navigate to http://localhost:3000 in your browser

### 2. Look for the Test Panel
You'll see a **"🧪 Plugin Brush Test Panel"** in the bottom-right corner with:
- Loading status indicator
- List of available plugin brushes (Dither Brush, Particle Brush)
- A small test canvas
- Current brush information

### 3. Test Plugin Brushes

#### Method 1: Using the Test Panel
1. Click the **"Test"** button next to any plugin brush
2. Watch the test canvas - it will draw a wavy line using that brush
3. Check the console for debug messages

#### Method 2: Using Plugin Brushes on Main Canvas
1. Click "Test" to activate a plugin brush
2. Draw on the main canvas - the plugin brush is now active
3. Switch between plugin brushes and default brushes
4. Notice how they work seamlessly together

### 4. What to Verify

✅ **Plugin Loading**
- Status shows "✅ Plugins Loaded"
- Two brushes appear: Dither Brush and Particle Brush
- Console shows: "✅ Loaded plugin brushes: Array(2)"

✅ **Brush Activation**
- Clicking "Test" activates the brush
- "Current Brush" updates to show plugin name
- "Is Plugin: Yes" appears for plugin brushes

✅ **Drawing Functionality**
- Test canvas shows different effects for each brush:
  - **Dither Brush**: Creates pixelated/dithered strokes
  - **Particle Brush**: Scatters particles along the path
- Main canvas works with plugin brushes
- No performance degradation

✅ **Integration**
- Can switch between default and plugin brushes
- Drawing handlers correctly route to appropriate engine
- No errors in console

### 5. Console Commands for Advanced Testing

Open the browser console (F12) and try:

```javascript
// Check loaded plugins
const store = window.useAppStore?.getState();
console.log('Current brush:', store?.currentBrushPreset);

// Manually test registry
const registry = window.brushRegistry;
console.log('Registry has brushes:', registry?.getAll());
```

### 6. Performance Testing

1. Activate a default brush (e.g., from Brush Library)
2. Draw quickly on canvas - should be smooth
3. Activate a plugin brush
4. Draw quickly - should still be smooth
5. Switch back to default - no lag or issues

### 7. Expected Console Output

When working correctly, you should see:
```
Loading plugin brushes...
✅ Loaded plugin brushes: (2) [{…}, {…}]
✅ Activated plugin brush: Dither Brush
✅ Drew test stroke with dither-brush
```

## Troubleshooting

### If brushes don't load:
1. Check console for errors
2. Refresh the page (Ctrl+R)
3. Ensure npm run dev is running

### If drawing doesn't work:
1. Check "Is Plugin: Yes" shows for plugin brushes
2. Verify brush is activated (Current Brush shows name)
3. Check console for routing messages

### If performance is poor:
1. Check if it's only with plugin brushes
2. Try different brush sizes
3. Monitor console for excessive logging

## How It Works

The system uses a **dual-path architecture**:

1. **Default Brushes** → `useBrushEngine` → Direct, optimized rendering
2. **Plugin Brushes** → `useUserBrushEngine` → Plugin system rendering

The `useDrawingHandlers` hook checks:
```typescript
if (userBrushEngine.isUserBrush(brushId)) {
  // Use plugin system
} else {
  // Use default system
}
```

This ensures zero performance impact on default brushes while enabling full modularity for plugins.

## Removing Test Component

When done testing, remove the test panel by:
1. Edit `/src/app/page.tsx`
2. Remove the import: `import TestPluginBrushes from '../components/TestPluginBrushes';`
3. Remove the component: `<TestPluginBrushes />`

The plugin system will still work - the test panel is just for demonstration!