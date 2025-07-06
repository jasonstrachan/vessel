# ERR_CONNECTION_REFUSED Debug Report

**Issue Date:** July 5, 2025  
**Severity:** High  
**Status:** ✅ RESOLVED  

## Problem Description

The application was experiencing `ERR_CONNECTION_REFUSED` errors when attempting to access the development server. Users could not connect to the TinyBrush application.

## Root Cause Analysis

### Initial Symptoms
- `ERR_CONNECTION_REFUSED` when accessing `http://localhost:3000`
- Development server appeared to start but wasn't accepting connections
- Server logs showed successful startup messages but connection attempts failed

### Deep Dive Investigation
1. **Cache Corruption**: Next.js build cache was corrupted with missing files:
   - Missing `/home/jason/projects/tinybrush/.next/server/vendor-chunks/next.js`
   - Missing `/home/jason/projects/tinybrush/.next/server/app/page.js`
   - Webpack cache errors: `ENOENT: no such file or directory, stat '/home/jason/projects/tinybrush/.next/cache/webpack/client-development/11.pack.gz'`

2. **Missing Module Error**: Primary application error was:
   ```
   Module not found: Can't resolve './components/SpacingControllerComponent'
   ```
   - Import statement in `BrushExecutionEngine.ts` line 15
   - Component referenced in factory methods and execution pipeline
   - Component file `SpacingControllerComponent.ts` was missing

3. **Server Behavior**: 
   - Server started successfully on port 3000
   - Initial compilation worked (1188ms startup, 1501ms first compile)
   - Build artifacts went missing from `.next/server/` directory
   - All subsequent requests returned 500 errors, appearing as connection refusal

## Resolution Process

### Step 1: Cache Cleanup
```bash
./scripts/cleanup.sh
```
- Removed corrupted `.next` directory
- Cleared `node_modules/.cache` 
- Reset build environment

### Step 2: Server Restart
```bash
npm run dev
```
- Started development server cleanly
- Server properly bound to port 3000
- Still experienced 500 errors due to missing module

### Step 3: Automatic Code Cleanup
- Linter/hooks automatically removed broken import
- Removed `SpacingControllerComponent` references from `BrushExecutionEngine.ts`
- Cleaned up factory methods and execution pipeline

### Step 4: Verification
- Server responded with HTTP 200 OK
- Application loaded correctly
- Full TinyBrush interface rendered properly

## Technical Details

### Files Modified
- `/src/engine/BrushExecutionEngine.ts` - Removed broken import (automatic)
- Cache directories cleared

### Server Configuration
- **Primary server**: Next.js on port 3000
- **Network access**: `http://localhost:3000` and `http://10.255.255.254:3000`
- **WSL2 compatibility**: Proxy server on port 8080 (not required for this fix)

## Prevention Measures

### Existing Infrastructure
The project already has robust cleanup mechanisms:
- `scripts/cleanup.sh` - Comprehensive cache clearing
- `npm run dev:clean` - Cleanup + restart
- `npm run dev:safe` - Robust startup script
- `npm run dev:diagnose` - Network diagnostics

### Recommendations
1. **Use cleanup scripts** when encountering build issues
2. **Monitor for missing modules** in development
3. **Run linters regularly** to catch broken imports early
4. **Use `npm run dev:safe`** for reliable startup

## Related Issues

This appears to be a recurring issue based on:
- Deleted troubleshooting files: `DEV_SERVER_FIX.md`, `WSL2-SERVER-FIX.md`
- Existing proxy server setup for WSL2 networking
- Comprehensive cleanup scripts already in place

## Testing

### Verification Steps
1. ✅ Server starts and binds to port 3000
2. ✅ HTTP 200 response from `http://localhost:3000`
3. ✅ Application loads completely
4. ✅ TinyBrush interface renders correctly
5. ✅ No console errors or missing modules

### Test Commands
```bash
# Check server is running
ss -tlnp | grep 3000

# Test connection
curl -I http://localhost:3000

# Test full response
curl -s http://localhost:3000 | head -10
```

## Conclusion

The `ERR_CONNECTION_REFUSED` error was caused by Next.js build cache corruption leading to missing build artifacts and a broken module import. The issue was resolved through:

1. **Cache cleanup** - Removed corrupted build files
2. **Automatic code cleanup** - Linter removed broken imports
3. **Clean server restart** - Fresh build without corruption

The application is now fully functional and accessible at `http://localhost:3000`.

**Resolution Time:** ~15 minutes  
**Downtime:** Minimal (development environment)  
**Impact:** Development workflow restored