# Common Issues

> **Note**: Server-related issues have been moved to [Server Troubleshooting Guide](./Server_Troubleshooting_Guide.md)
> 
> **Recent Fixes**: For the latest resolved issues, see:
> - [ERR_CONNECTION_REFUSED Debug Report](./ERR_CONNECTION_REFUSED_Debug.md)
> - [JavaScript Assets 404 Debug Report](./JS_Assets_404_Debug.md)

## Build and Development Server Issues

### Issue: ERR_CONNECTION_REFUSED / Server Won't Start
**Status:** ✅ RESOLVED - [Full Debug Report](./ERR_CONNECTION_REFUSED_Debug.md)

**Symptoms:**
- `ERR_CONNECTION_REFUSED` when accessing `http://localhost:3000`
- Development server appears to start but won't accept connections
- Next.js compilation errors about missing modules

**Quick Fix:**
```bash
# Complete build cleanup
rm -rf .next tsconfig.tsbuildinfo
./scripts/cleanup.sh
npm run dev
```

**Root Cause:** Next.js build cache corruption causing webpack module resolution failures.

### Issue: JavaScript Assets 404 Errors
**Status:** ✅ RESOLVED - [Full Debug Report](./JS_Assets_404_Debug.md)

**Symptoms:**
- Browser console shows 404 errors for main.js, webpack.js, _app.js
- Application loads but JavaScript functionality broken
- HTML references fallback assets that don't exist

**Quick Fix:**
```bash
# Same as above - complete cleanup resolves both issues
rm -rf .next tsconfig.tsbuildinfo
./scripts/cleanup.sh
npm run dev
```

**Root Cause:** Next.js fallback mode activation due to build corruption.

### Issue: Root Path Returns 404 Not Found
**Status:** ✅ RESOLVED - Build cache corruption (2025-01-07)

**Symptoms:**
- HTTP 404 errors when accessing `http://localhost:3000/`
- Browser console shows: "Failed to load resource: the server responded with a status of 404 (Not Found)"
- Dev server starts successfully but root path is inaccessible
- Repeated GET requests to localhost:3000 fail with 404

**Quick Fix:**
```bash
# Remove corrupted build cache
rm -rf .next
npm run dev
```

**Root Cause:** Next.js 15.3.4 build cache corruption in WSL2 environments. The `.next/server/app/page.js` file was missing from the build cache, causing the app router to fail serving the root path "/" even though the source file `src/app/page.tsx` was properly structured.

**Environment:** WSL2 + Next.js 15.3.4 with App Router

## Canvas and Rendering Issues

### Issue: Canvas Not Displaying or Black Screen
**Symptoms:**
- Canvas area shows black or empty
- Drawing operations not visible
- No error messages in console

**Causes:**
- P5.js initialization failure
- WebGL context loss
- Canvas size issues
- Component mounting problems

**Diagnostic Steps:**
```bash
# Check browser console for errors
# Look for WebGL or canvas errors

# Verify P5.js is loaded
console.log(window.p5)

# Check canvas element exists
document.querySelector('canvas')

# Test canvas context
canvas.getContext('2d')
```

**Resolution:**
```javascript
// 1. Ensure proper P5.js initialization
useEffect(() => {
  if (typeof window !== 'undefined') {
    // Initialize P5.js only on client side
    const sketch = (p5) => {
      p5.setup = () => {
        p5.createCanvas(800, 600)
      }
    }
    new p5(sketch, canvasRef.current)
  }
}, [])

// 2. Handle WebGL context loss
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  // Reinitialize WebGL context
})

// 3. Fallback to 2D context if WebGL fails
try {
  context = canvas.getContext('webgl2') || canvas.getContext('webgl')
} catch (e) {
  context = canvas.getContext('2d')
}
```

### Issue: Poor Drawing Performance
**Symptoms:**
- Lag between brush strokes and display
- Low frame rate during drawing
- Browser becomes unresponsive

**Causes:**
- Large canvas size
- Too many layers
- Inefficient brush algorithms
- Memory leaks

**Diagnostic Steps:**
```javascript
// Monitor performance
console.time('drawing-operation')
// ... drawing code ...
console.timeEnd('drawing-operation')

// Check memory usage
console.log(performance.memory)

// Monitor frame rate
let fps = 0
setInterval(() => {
  console.log('FPS:', fps)
  fps = 0
}, 1000)
```

**Resolution:**
```javascript
// 1. Optimize brush rendering
const optimizedBrush = {
  // Use distance-based spacing
  spacing: Math.max(1, brushSize * 0.25),
  
  // Batch stroke points
  points: [],
  renderBatch() {
    if (this.points.length > 10) {
      // Render batch of points
      this.points = []
    }
  }
}

// 2. Limit canvas size
const MAX_CANVAS_SIZE = 4096
const constrainedSize = Math.min(requestedSize, MAX_CANVAS_SIZE)

// 3. Use layer caching
const layerCache = new Map()
const getCachedLayer = (layerId) => {
  if (!layerCache.has(layerId)) {
    layerCache.set(layerId, createLayer())
  }
  return layerCache.get(layerId)
}
```

## Memory and Performance Issues

### Issue: Memory Leaks During Extended Use
**Symptoms:**
- Browser memory usage continuously increases
- Application becomes slower over time
- Browser tab crashes after prolonged use

**Causes:**
- Unreleased canvas contexts
- Event listeners not removed
- Large undo history
- Cached images not cleared

**Diagnostic Steps:**
```javascript
// Monitor memory usage
const measureMemory = () => {
  if (performance.memory) {
    console.log({
      used: Math.round(performance.memory.usedJSHeapSize / 1048576),
      allocated: Math.round(performance.memory.totalJSHeapSize / 1048576),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    })
  }
}

setInterval(measureMemory, 5000)
```

**Resolution:**
```javascript
// 1. Proper cleanup in useEffect
useEffect(() => {
  const handleResize = () => { /* ... */ }
  window.addEventListener('resize', handleResize)
  
  return () => {
    window.removeEventListener('resize', handleResize)
    // Cleanup P5.js instance
    if (p5Instance) {
      p5Instance.remove()
    }
  }
}, [])

// 2. Limit undo history
const MAX_UNDO_STEPS = 50
const addUndoAction = (action) => {
  undoHistory.push(action)
  if (undoHistory.length > MAX_UNDO_STEPS) {
    undoHistory.shift()
  }
}

// 3. Clear image caches periodically
const clearImageCache = () => {
  imageCache.clear()
  brushCache.clear()
  // Force garbage collection (if available)
  if (window.gc) window.gc()
}
```

### Issue: Export Fails for Large Animations
**Symptoms:**
- GIF export hangs or crashes
- "Out of memory" errors during export
- Browser becomes unresponsive

**Causes:**
- Too many frames in animation
- High resolution export settings
- Insufficient memory for processing

**Diagnostic Steps:**
```javascript
// Check export parameters
console.log({
  frameCount: frames.length,
  resolution: `${width}x${height}`,
  estimatedMemory: frames.length * width * height * 4 / 1048576 + 'MB'
})
```

**Resolution:**
```javascript
// 1. Limit export parameters
const MAX_EXPORT_FRAMES = 100
const MAX_EXPORT_RESOLUTION = 1920

const validateExportSettings = (settings) => {
  if (settings.frames > MAX_EXPORT_FRAMES) {
    throw new Error(`Maximum ${MAX_EXPORT_FRAMES} frames allowed`)
  }
  if (settings.width > MAX_EXPORT_RESOLUTION) {
    throw new Error(`Maximum ${MAX_EXPORT_RESOLUTION}px width allowed`)
  }
}

// 2. Process export in chunks
const exportInChunks = async (frames, chunkSize = 10) => {
  const chunks = []
  for (let i = 0; i < frames.length; i += chunkSize) {
    chunks.push(frames.slice(i, i + chunkSize))
  }
  
  for (const chunk of chunks) {
    await processChunk(chunk)
    // Allow browser to breathe
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
```

## Browser Compatibility Issues

### Issue: Features Not Working in Older Browsers
**Symptoms:**
- Canvas not displaying in Safari 13
- Touch events not working on mobile
- WebGL features unavailable

**Causes:**
- Missing browser feature support
- Polyfills not loaded
- Different API implementations

**Diagnostic Steps:**
```javascript
// Check feature support
const checkSupport = () => {
  console.log({
    webgl: !!window.WebGLRenderingContext,
    webgl2: !!window.WebGL2RenderingContext,
    canvas: !!window.HTMLCanvasElement,
    imageData: !!window.ImageData,
    clipboard: !!navigator.clipboard
  })
}
```

**Resolution:**
```javascript
// 1. Feature detection and fallbacks
const getCanvasContext = (canvas) => {
  // Try WebGL2 first, then WebGL, then 2D
  return canvas.getContext('webgl2') ||
         canvas.getContext('webgl') ||
         canvas.getContext('2d')
}

// 2. Polyfills for missing features
if (!navigator.clipboard) {
  // Fallback clipboard implementation
  navigator.clipboard = {
    writeText: async (text) => {
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }
}

// 3. Touch event handling
const handlePointerEvent = (e) => {
  // Unified pointer event handling
  const point = e.touches ? e.touches[0] : e
  return {
    x: point.clientX,
    y: point.clientY,
    pressure: e.pressure || 0.5
  }
}
```

## File and Data Issues

### Issue: Projects Not Saving or Loading
**Symptoms:**
- Save operation appears to succeed but data is lost
- Load operation fails with no error message
- LocalStorage quota exceeded errors

**Causes:**
- LocalStorage quota limits
- Data serialization issues
- Browser privacy settings

**Diagnostic Steps:**
```javascript
// Check LocalStorage usage
const checkStorage = () => {
  let total = 0
  for (let key in localStorage) {
    total += localStorage[key].length
  }
  console.log('LocalStorage usage:', total, 'bytes')
  console.log('Estimated remaining:', (5 * 1024 * 1024 - total), 'bytes')
}
```

**Resolution:**
```javascript
// 1. Compress data before storing
const compressProjectData = (project) => {
  // Remove unnecessary data
  const compressed = {
    ...project,
    layers: project.layers.map(layer => ({
      ...layer,
      imageData: compressImageData(layer.imageData)
    }))
  }
  return JSON.stringify(compressed)
}

// 2. Implement storage quota management
const saveWithQuotaCheck = (key, data) => {
  try {
    localStorage.setItem(key, data)
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      // Clear old projects to make space
      clearOldProjects()
      localStorage.setItem(key, data)
    }
  }
}

// 3. Fallback to IndexedDB for large projects
const saveToIndexedDB = async (project) => {
  const db = await openDB('tinybrush', 1)
  await db.put('projects', project)
}
```

## Troubleshooting Workflow

### General Debugging Steps
1. **Check Browser Console**: Look for JavaScript errors and warnings
2. **Verify Network**: Ensure all resources are loading correctly
3. **Test in Incognito**: Rule out extension or cache issues
4. **Clear Cache**: Clear browser cache and localStorage
5. **Update Browser**: Ensure browser is up to date

### Performance Debugging
```javascript
// Enable performance monitoring
const enableDebugMode = () => {
  window.TINYBRUSH_DEBUG = true
  
  // Log all state changes
  const originalSetState = useState
  useState = (initial) => {
    const [state, setState] = originalSetState(initial)
    return [state, (newState) => {
      console.log('State change:', newState)
      setState(newState)
    }]
  }
}
```

### Emergency Recovery
```javascript
// Reset application state
const emergencyReset = () => {
  // Clear all storage
  localStorage.clear()
  sessionStorage.clear()
  
  // Reset to default state
  window.location.reload()
}

// Export current work before reset
const emergencyExport = () => {
  const canvas = document.querySelector('canvas')
  const dataURL = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.download = 'emergency-backup.png'
  link.href = dataURL
  link.click()
}
```

---

*This troubleshooting guide covers the most common issues encountered when developing and using TinyBrush, with comprehensive diagnostic steps and solutions.*