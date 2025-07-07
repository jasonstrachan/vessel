# Server Shutdown Issue - Diagnosis & Fix Plan

## Problem Summary
The Next.js dev server is crashing during runtime due to missing/corrupted build artifacts in the `.next` directory.

## Root Cause Analysis

### 1. Primary Issue: Corrupted Build Cache
- **Symptom**: Server crashes with ENOENT errors for critical Next.js files
- **Evidence**: 
  - Missing `/home/jason/projects/tinybrush/.next/server/vendor-chunks/next.js`
  - Missing `/home/jason/projects/tinybrush/.next/server/app-paths-manifest.json`
  - Missing `/home/jason/projects/tinybrush/.next/server/pages-manifest.json`
- **Impact**: Server returns 404/500 errors for all requests

### 2. Build Process Interruption
- Server initially compiles successfully (line 13: "Compiled / in 4.3s")
- After serving initial requests, build artifacts get corrupted/deleted
- Repeated compilation attempts (lines 22-56) suggest hot reload is trying to recover
- Eventually fails with "Cannot read properties of undefined (reading 'clientModules')"

### 3. Configuration Issues
- `config.cache = false` in development may cause build instability
- Aggressive file watching with `poll: 1000` could trigger premature rebuilds
- Experimental `forceSwcTransforms` flag might contribute to instability

## Fix Implementation Plan

### Step 1: Clean Build Environment
```bash
rm -rf .next
rm -rf node_modules/.cache
rm -rf .turbo
```

### Step 2: Update next.config.ts
Remove problematic development overrides:
- Remove `config.cache = false` 
- Increase or remove poll interval
- Temporarily disable experimental features

### Step 3: Ensure Clean Dependencies
```bash
npm install
```

### Step 4: Start Fresh Dev Server
```bash
npm run dev
```

### Step 5: Monitor for Stability
- Watch for ENOENT errors
- Verify hot reload works without corruption
- Test multiple page refreshes

## Validation Steps

1. Server starts without errors
2. Pages load successfully (200 status)
3. Hot reload works without corrupting .next directory
4. No ENOENT errors in logs
5. Server remains stable for at least 5 minutes of active development

## Alternative Solutions (if primary fix fails)

1. **Disable File Watching**: Set `watchOptions: { ignored: /node_modules/ }`
2. **Use Production Build**: `npm run build && npm run start` for testing
3. **Check File System**: Ensure no antivirus/backup software is interfering
4. **Memory Check**: Increase Node.js memory limit if needed
5. **Downgrade Next.js**: If issue is version-specific

## Success Criteria
- Dev server runs continuously without crashes
- No missing manifest errors
- Hot reload functions properly
- Development workflow is uninterrupted