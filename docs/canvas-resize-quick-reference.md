# Canvas Resize - Quick Reference

## 🚨 CRITICAL: Always Do This When Modifying Canvas Code

### 1. Update DOM Attributes, Not Just CSS
```typescript
// ❌ WRONG - Only CSS
canvas.style.width = `${width}px`;

// ✅ CORRECT - Both DOM attributes AND CSS  
canvas.width = width * devicePixelRatio;  // DOM buffer size
canvas.style.width = `${width}px`;        // CSS display size
```

### 2. Use the needsDimensionUpdate Flag Pattern
```typescript
// ❌ WRONG - Direct DOM manipulation
canvas.width = newWidth;

// ✅ CORRECT - State-driven updates
setCanvasDimensions(newWidth, newHeight); // Sets needsDimensionUpdate: true
// React useEffect handles DOM updates automatically
```

### 3. Always Use Current Canvas Dimensions
```typescript
// ❌ WRONG - Using potentially stale props
const worldX = (screenX - canvas.panX) / canvas.zoom;

// ✅ CORRECT - Using current state dimensions
const currentWidth = canvas.canvasWidth || width;
const clampedX = Math.max(0, Math.min(screenX, currentWidth));
const worldX = (clampedX - canvas.panX) / canvas.zoom;
```

## 🔧 Quick Debugging Commands

```javascript
// Check DOM vs State sync
const canvas = canvasRef.current;
console.log('DOM vs State:', {
  domWidth: canvas.width,
  domHeight: canvas.height, 
  stateWidth: canvas.canvasWidth,
  stateHeight: canvas.canvasHeight,
  needsUpdate: canvas.needsDimensionUpdate
});

// Test coordinate transformation
const coords = transformScreenToCanvas(event.clientX, event.clientY);
console.log('Coords:', coords);
```

## ⚡ Instant Fix Checklist

Canvas cursor misaligned after resize?

- [ ] Canvas DOM `.width` and `.height` attributes updated?
- [ ] Wrapper element dimensions match canvas?  
- [ ] `needsDimensionUpdate` flag handled in useEffect?
- [ ] `transformScreenToCanvas` using `canvas.canvasWidth`?
- [ ] Layer recomposition triggered after resize?

## 📁 Key Files Modified

- `src/stores/useAppStore.ts` - State management + flags
- `src/components/canvas/DrawingCanvas.tsx` - DOM updates + coordinate transforms  
- `src/types/index.ts` - Added `needsDimensionUpdate` to CanvasState

## 🧪 Quick Test

```javascript
// Resize test
resizeCanvas(800, 600);
// Click center of canvas
// Drawing should appear exactly where you clicked
```

---

**If broken**: Check the full solution in `docs/canvas-resize-cursor-alignment-fix.md`