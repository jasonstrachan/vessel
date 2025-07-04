# Next.js Build Cache Corruption - 500 Errors

## Problem
Server returns 500 Internal Server Error for all static assets (main-app.js, app-pages-internals.js, layout.css) instead of serving the application.

## Root Cause
Corrupted Next.js build cache in `.next` directory. Specifically:
- `.next/server/app/_not-found/page.js` missing
- Other partial build artifacts present
- Next.js can't handle missing critical server files

## Symptoms
- Multiple 500 errors in browser console
- Static assets fail to load
- Server appears running but serves errors
- Font preload warnings (secondary issue)

## Solution
1. **Run cleanup script**: `./scripts/cleanup.sh`
   - Kills Next.js processes (preserves VS Code)
   - Removes corrupted `.next` directory
   - Cleans `node_modules/.cache`

2. **Fresh restart**: `npm run dev`

## Prevention
- Use cleanup script when switching branches
- Clear cache after failed builds
- Monitor for partial compilation artifacts
- Don't manually edit `.next` directory contents

## Quick Check
Verify `.next/server/app/_not-found/page.js` exists after builds. If missing, run cleanup.