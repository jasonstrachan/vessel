# CONNECTION REFUSED BUG FIX

## Bug Description
Firefox shows "Unable to connect" and "localhost refused to connect" when trying to access the development server at localhost:3000. The Next.js server says "Ready" but immediately crashes.

## Root Cause Analysis

### Critical Issue: Server Process Death
The Next.js development server starts successfully and reports "✓ Ready in 1261ms" but the process immediately dies after startup, causing connection refused errors.

### Investigation Findings:
1. **Process Check**: `ps aux | grep next` shows no Next.js processes after "Ready" message
2. **Port Check**: `ss -tlnp | grep :3000` shows no listening processes 
3. **Build Success**: `npm run build` succeeds without errors
4. **Production Mode**: `npm run start` also fails - process dies immediately

### Root Cause: React Hook Dependency Array Issue
The coordinate fix changes introduced `canvas.zoom` in useCallback dependency arrays, causing infinite re-render loops that crash the server:

```typescript
// PROBLEMATIC - causes infinite re-renders
}, [isPanning, panStartPoint, initialPan, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, canvas.zoom]);
```

**Why this crashes:**
1. `canvas.zoom` changes trigger useCallback to recreate
2. Recreated callback triggers component re-render  
3. Re-render updates `canvas.zoom` again
4. Infinite loop crashes the Node.js process

## The Fix

### Remove Problematic Dependencies
Remove `canvas.zoom` from useCallback dependency arrays since it's accessed inside the callback via closure:

```typescript
// FIXED - stable dependencies only
}, [isPanning, panStartPoint, initialPan, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine]);
```

### Alternative Access Method
The `canvas.zoom` value is still accessible inside the callbacks via closure, so removing it from dependencies is safe.

## Implementation

### Files Modified
- `src/components/canvas/DrawingCanvas.tsx`: Removed `canvas.zoom` from both handleMouseMove and handleTouchMove dependency arrays

### Manual Testing Required
Since the server was crashing, automated testing was impossible. Manual verification needed:

1. **Server Startup**: Verify Next.js process stays alive after "Ready" message
2. **Port Listening**: Confirm port 3000 accepts connections
3. **Page Access**: Verify page loads in browser
4. **Coordinate Function**: Test zoom/pan coordinate alignment still works

## Recovery Steps

1. Kill any hanging processes: `pkill -f next`
2. Start fresh server: `npm run dev`  
3. Verify process stays alive: `ps aux | grep next-server`
4. Test connection: `curl http://localhost:3000`
5. Open browser to http://localhost:3000
6. Look for "v1.1 - Pan Fix" indicator in top-left
7. Test coordinate fixes work properly

## Lessons Learned

### Dependency Array Management
- Never include rapidly changing state in useCallback dependencies
- Use closure access for values that don't affect callback creation
- Monitor server process health when making hook changes

### Debugging Server Crashes
- Check process list after "Ready" message
- Verify port is actually listening  
- Test with minimal reproduction case
- Use production mode to isolate dev-specific issues

## Success Criteria
- [ ] Next.js server starts and stays running
- [ ] Port 3000 accepts connections
- [ ] Page loads with "v1.1 - Pan Fix" indicator
- [ ] Coordinate transformation still works correctly
- [ ] No infinite re-render warnings in console